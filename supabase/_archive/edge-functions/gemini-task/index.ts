import { createClient } from "npm:@supabase/supabase-js@2.49.1";
// --- HELPERS ---
function log(stage, payload) {
  console.log(`[${stage}]`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
}
function toBase64(bytes) {
  if (bytes.toBase64) return bytes.toBase64();
  let binary = "";
  const chunkSize = 0x8000;
  for(let i = 0; i < bytes.length; i += chunkSize){
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function getValidMimeType(filename, existingMime) {
  const mime = (existingMime || "").toLowerCase();
  if (mime && mime !== "application/octet-stream") return mime;
  const ext = filename.split('.').pop()?.toLowerCase();
  switch(ext){
    case 'pdf':
      return 'application/pdf';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return 'application/pdf';
  }
}
// --- CORE LOGIC ---
async function processOneDocument(args) {
  const { supabase, document_id, requestId, geminiKey } = args;
  const { data: doc, error: docErr } = await supabase.from("case_documents").select("*").eq("id", document_id).single();
  if (docErr || !doc) throw new Error(`Doc not found: ${document_id}`);
  const { data: fileData, error: dlErr } = await supabase.storage.from(doc.storage_bucket).download(doc.storage_path);
  if (dlErr || !fileData) throw new Error(`Download failed: ${dlErr?.message}`);
  const bytes = new Uint8Array(await fileData.arrayBuffer());
  const base64 = toBase64(bytes);
  const mimeType = getValidMimeType(doc.storage_path, doc.mime_type);
  // SETTINGS
  const model = "gemini-3-pro-preview";
  const prompt_version = "sota_v1";
  const pipeline_version = "fanout_v1";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const geminiPrompt = `
You are an evidence document processor for a financial scam dispute case.
You will receive ONE file (image or PDF). Your job is to:
1) Extract readable text as "raw_text" (preserve numbers exactly).
2) Predict the document type from: POLICE_REPORT, BANK_STATEMENT, DISPUTE_FORM, BANK_COMMS, FRAUD_SCREENSHOTS, CYBER_REPORT, USER_LOGS, OTHER
3) Provide confidence score 0..1.
4) Provide 3-6 "evidence_spans" quotes.
5) Extract "transactions" if present.

Return STRICT JSON only:
{
  "predicted_document_type": "TYPE",
  "confidence": 0.0,
  "evidence_spans": [{"quote":"...", "page": 1}],
  "raw_text": "...",
  "transactions": [{"date":"YYYY-MM-DD","merchant":"string","amount":123.45,"currency":"SGD","status":"string"}],
  "notes": "string"
}
`.trim();
  const geminiResp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: geminiPrompt
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: "application/json"
      }
    })
  });
  if (!geminiResp.ok) throw new Error(`Gemini API Error: ${await geminiResp.text()}`);
  const geminiJson = await geminiResp.json();
  const rawOutput = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  let parsed;
  try {
    const start = rawOutput.indexOf("{");
    const end = rawOutput.lastIndexOf("}");
    parsed = JSON.parse(rawOutput.slice(start, end + 1));
  } catch  {
    parsed = {
      raw_text: rawOutput
    };
  }
  // 1. CONTENT INSERT (Fixed per schema image_aa6cba.png)
  const { data: contentRow, error: contentErr } = await supabase.from("case_documents_content").insert([
    {
      document_id,
      model,
      prompt_version,
      pipeline_version,
      text_content: parsed.raw_text || rawOutput,
      content_json: parsed,
      parse_status: "success"
    }
  ]).select("id").single();
  if (contentErr || !contentRow) {
    throw new Error(`Failed to create content row: ${contentErr?.message}`);
  }
  const content_id = contentRow.id;
  // 2. VERIFICATIONS (Fixed per schema image_a99399.png)
  const d = (doc.document_type ?? "").trim().toUpperCase();
  const p = (parsed.predicted_document_type ?? "OTHER").trim().toUpperCase();
  const c = parsed.confidence ?? 0;
  const decision = d === p && c >= 0.8 ? "accepted" : d !== p && c >= 0.8 ? "rejected" : "needs_review";
  const { error: vErr } = await supabase.from("case_document_verifications").insert([
    {
      document_id,
      content_id,
      declared_document_type: doc.document_type,
      predicted_document_type: p,
      confidence: c,
      decision,
      reason: `Match: ${d === p}, Confidence: ${c}`,
      evidence_spans: parsed.evidence_spans || [],
      model,
      prompt_version
    }
  ]);
  if (vErr) log("VERIFICATION_ERROR", vErr);
  // 3. EXTRACTIONS (Fixed per schema image_a99326.png)
  const { error: eErr } = await supabase.from("case_document_extractions").insert([
    {
      case_id: doc.case_id,
      document_id,
      content_id,
      extraction_type: "doc_summary",
      schema_version: "v1",
      extracted_json: parsed,
      extracted_text: parsed.raw_text || null,
      confidence: c,
      citations: parsed.evidence_spans || [],
      model,
      prompt_version
    }
  ]);
  if (eErr) log("EXTRACTION_ERROR", eErr);
  // 4. UPDATE MASTER DOC
  await supabase.from("case_documents").update({
    content_latest_id: content_id,
    processing_status: "ready",
    is_processed: true,
    verified_document_type: p,
    verification_status: decision
  }).eq("id", document_id);
  return {
    ok: true
  };
}
// --- SERVE ---
Deno.serve(async (req)=>{
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const supabase = createClient(supabaseUrl, serviceKey);
  try {
    const { document_id, case_id } = await req.json();
    if (document_id) {
      log("WORKER_START", document_id);
      return new Response(JSON.stringify(await processOneDocument({
        supabase,
        document_id,
        requestId: crypto.randomUUID(),
        geminiKey
      })));
    }
    if (case_id) {
      log("MANAGER_START", case_id);
      const { data: docs } = await supabase.from("case_documents").select("id").eq("case_id", case_id);
      if (!docs || docs.length === 0) return new Response("No docs", {
        status: 404
      });
      const functionUrl = `${supabaseUrl}/functions/v1/process-documents`;
      const triggers = docs.map((d)=>fetch(functionUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            document_id: d.id
          })
        }));
      await Promise.all(triggers);
      return new Response(JSON.stringify({
        dispatched: docs.length
      }), {
        status: 202
      });
    }
    return new Response("Bad Request", {
      status: 400
    });
  } catch (e) {
    log("GLOBAL_ERROR", e.message);
    return new Response(JSON.stringify({
      error: e.message
    }), {
      status: 500
    });
  }
});
