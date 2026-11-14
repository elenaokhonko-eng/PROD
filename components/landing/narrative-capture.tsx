'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Mic, Pause, Play, Square, Trash2, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { trackClientEvent } from '@/lib/analytics/client'
import { trackFunnel } from '@/lib/analytics/funnel'
import { ACCOUNT_NOTICE, SUBMIT_STORY } from '@/lib/harbor/cta'
import { persistPendingNarrative, readPendingNarrative } from '@/components/landing/hero-capture'

// Brief W1 Addendum V §V4: a one-line placeholder; the worked example (finding B1, synthetic) is shown below the box.
export const STORY_PLACEHOLDER = 'Start anywhere. You can edit it before you continue.'
export const STORY_EXAMPLE =
  "For example: On 12 March 2026, at about 9 pm, I received an email that looked like it came from my bank. It said my digital token would expire within 24 hours and gave a link to re-activate it. I clicked the link and entered my login details and the one-time code to re-activate the token. Overnight I received several SMS alerts from the bank about transfers out of my savings account, about S$1,200 each, but I was asleep and only saw them at 7 am. There were also three large transactions on my credit card to a merchant overseas. I immediately called the bank's hotline, reported the transfers and asked them to block the account; the officer gave me a case number. I filed a police report online the same morning. In total about S$9,800 was taken from my savings account and S$3,100 charged to my credit card. The bank has acknowledged my report but hasn't given me a final answer yet."

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function NarrativeCapture({ initialNarrative = '' }: { initialNarrative?: string }) {
  const router = useRouter()
  const [narrative, setNarrative] = useState(initialNarrative)
  const [inputMethod, setInputMethod] = useState<'text' | 'voice'>('text')
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [audioPreview, setAudioPreview] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const guidanceRef = useRef<HTMLDetailsElement>(null)

  // Brief W1 §C: "What should I include?" starts collapsed on phones and open on wider screens. Opened after mount, so
  // the server and the first client render agree.
  useEffect(() => {
    if (guidanceRef.current && window.matchMedia('(min-width: 640px)').matches) guidanceRef.current.open = true
  }, [])

  useEffect(() => {
    const savedDraft = initialNarrative ? null : readPendingNarrative()
    if (savedDraft?.narrative) {
      setNarrative(savedDraft.narrative)
      setRestoredDraft(true)
    }

    const updateOnlineStatus = () => setIsOnline(navigator.onLine)
    updateOnlineStatus()
    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [initialNarrative])

  useEffect(() => {
    if (narrative.trim()) persistPendingNarrative({ narrative, transcript: inputMethod === 'voice' ? narrative : undefined })
  }, [inputMethod, narrative])

  useEffect(() => {
    if (!isRecording || isPaused) return
    const timer = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [isPaused, isRecording])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      const recorder = recorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    return () => {
      if (audioPreview) URL.revokeObjectURL(audioPreview)
    }
  }, [audioPreview])

  const startRecording = async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this browser. You can type your story instead.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      streamRef.current = stream
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setIsRecording(false)
        setIsPaused(false)
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        const nextPreview = URL.createObjectURL(blob)
        setAudioPreview((current) => {
          if (current) URL.revokeObjectURL(current)
          return nextPreview
        })
        setIsTranscribing(true)
        const controller = new AbortController()
        abortRef.current = controller
        try {
          const form = new FormData()
          form.append('audio', blob, 'recording.webm')
          const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: form,
            signal: controller.signal,
          })
          const data = await response.json()
          if (!response.ok || !data.transcription) {
            throw new Error(data.error || 'The recording could not be transcribed.')
          }
          setNarrative(data.transcription)
          trackFunnel('story_started')
        } catch (recordingError) {
          if ((recordingError as Error).name !== 'AbortError') {
            setError((recordingError as Error).message || 'The recording could not be transcribed. You can still type your story.')
          }
        } finally {
          abortRef.current = null
          setIsTranscribing(false)
          recorderRef.current = null
        }
      }
      recorder.start()
      setRecordingSeconds(0)
      setIsRecording(true)
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      setError('Microphone access was not available. Check browser permissions or type your story instead.')
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  const togglePause = () => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'recording') {
      recorder.pause()
      setIsPaused(true)
    } else if (recorder.state === 'paused') {
      recorder.resume()
      setIsPaused(false)
    }
  }

  const discardRecording = () => {
    setAudioPreview((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
  }

  const submitNarrative = async () => {
    if (!narrative.trim()) {
      setError('Tell GuideBuoy a little about what happened before continuing.')
      return
    }
    if (!isOnline) {
      setError('You’re offline. Your story is saved on this device; reconnect before continuing.')
      return
    }
    setError(null)
    setIsProcessing(true)
    try {
      persistPendingNarrative({ narrative: narrative.trim(), transcript: inputMethod === 'voice' ? narrative.trim() : undefined })
      trackFunnel('story_submitted')
      await trackClientEvent({
        eventName: 'story_submitted',
        sessionId: null,
        pageUrl: window.location.href,
        eventData: { narrative_length: narrative.trim().length, input_method: inputMethod },
      })
      router.push('/sign-up?redirect_url=/onboarding')
    } catch {
      setError('Your story could not be saved. It is still here — check your connection and try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <section className="gb-card-raised p-5 sm:p-7" aria-labelledby="capture-title" aria-busy={isProcessing || isTranscribing}>
      {/* Brief W1 §A1: the old headline now introduces the story box, where the visitor does exactly that. */}
      <p className="text-sm font-semibold text-primary">Tell us once. We&apos;ll help you carry it from here.</p>
      <div className="mt-1 flex items-start gap-3">
        <h2 id="capture-title" className="flex-1 text-2xl font-semibold text-harbor-deep">
          Tell GuideBuoy what happened — in your own words.
        </h2>
        {/* §A2: on phones the mascot sits small beside the story heading instead of between the hero and the box. */}
        <Image src="/assets/harbor/lumi-buoy.jpg" alt="" width={64} height={64} className="size-16 shrink-0 rounded-2xl object-cover lg:hidden" />
      </div>
      <p className="mt-2 leading-6 text-muted-foreground">There is no wrong way to begin. You can edit your words before continuing.</p>

      {!isOnline && (
        <div className="mt-4 flex gap-2 rounded-xl border border-harbor-gold/50 bg-harbor-gold-wash p-3 text-sm leading-6" role="status">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>You’re offline. Your unfinished story stays in this browser tab and can be submitted after you reconnect, as long as the tab stays open.</span>
        </div>
      )}
      {restoredDraft && (
        <p className="mt-4 rounded-xl bg-harbor-sage-tint p-3 text-sm leading-6" role="status">
          Your unfinished story was restored from this browser tab.
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="How to tell your story">
        <Button type="button" variant={inputMethod === 'text' ? 'default' : 'outline'} aria-pressed={inputMethod === 'text'} disabled={isRecording || isTranscribing} onClick={() => setInputMethod('text')}>
          <FileText aria-hidden="true" /> Type my story
        </Button>
        <Button type="button" variant={inputMethod === 'voice' ? 'default' : 'outline'} aria-pressed={inputMethod === 'voice'} disabled={isRecording || isTranscribing} onClick={() => setInputMethod('voice')}>
          <Mic aria-hidden="true" /> Record my story
        </Button>
      </div>

      <div className="mt-5">
        {inputMethod === 'voice' && (
          <div className="mb-4 rounded-xl border bg-harbor-teal-tint p-4">
            <div className="flex flex-wrap items-center gap-3">
              {!isRecording ? (
                <Button type="button" onClick={() => void startRecording()} disabled={isTranscribing || !isOnline}>
                  <Mic aria-hidden="true" /> Start recording
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={togglePause}>
                    {isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                    {isPaused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button type="button" variant="destructive" onClick={stopRecording}>
                    <Square aria-hidden="true" /> Stop
                  </Button>
                </>
              )}
              <span role="status" aria-live="polite" className="text-sm font-medium">
                {isRecording ? `${isPaused ? 'Paused' : 'Recording'} ${formatTime(recordingSeconds)}` : isTranscribing ? 'Transcribing recording…' : 'Ready to record'}
              </span>
            </div>
            {audioPreview && !isRecording && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <audio className="min-w-0 flex-1" controls src={audioPreview} aria-label="Play back your recording" />
                <Button type="button" variant="outline" onClick={discardRecording}>
                  <Trash2 aria-hidden="true" /> Discard recording
                </Button>
              </div>
            )}
          </div>
        )}

        <label htmlFor="story" className="mb-2 block font-medium">
          Your story
        </label>
        {/* §C and V4: starts at about five lines and grows with the story, up to 60% of the screen. */}
        <Textarea
          id="story"
          value={narrative}
          onChange={(event) => {
            setNarrative(event.target.value)
            trackFunnel('story_started')
          }}
          rows={5}
          aria-describedby="story-include story-privacy"
          placeholder={STORY_PLACEHOLDER}
          className="max-h-[60vh] min-h-36 resize-none overflow-y-auto bg-card text-base leading-7 focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-harbor-error-tint p-4 text-sm">
          {error}
        </div>
      )}

      {/* §C: the button sits directly under the box, before the guidance. */}
      <Button type="button" size="lg" className="mt-4 w-full text-base font-semibold" disabled={isProcessing || isTranscribing || isRecording || !isOnline} onClick={() => void submitNarrative()}>
        {isProcessing && <Loader2 className="animate-spin" aria-hidden="true" />}
        {isProcessing ? 'Saving your story…' : SUBMIT_STORY}
      </Button>
      {/* Brief W1 §B2: no surprise sign-in wall after a painful story. */}
      <p className="mt-3 text-center text-sm leading-6 text-muted-foreground">{ACCOUNT_NOTICE}</p>
      <p id="story-privacy" className="mt-4 text-sm leading-6 text-muted-foreground">
        Your draft stays in this browser tab until you sign in. It is deleted when you close the tab. Voice is sent for transcription when you stop recording.
      </p>

      {/* V4: the worked example (finding B1, Elena 7 Nov) moves out of the placeholder, word for word. */}
      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">See an example</summary>
        <blockquote className="mt-2 border-l-2 border-primary/40 pl-4 text-base leading-7 text-foreground">{STORY_EXAMPLE}</blockquote>
      </details>

      {/* Finding B2: one instruction. §C: collapsed on phones, open on wider screens. */}
      <details ref={guidanceRef} className="mt-2">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">What should I include?</summary>
        <ul id="story-include" className="list-disc space-y-1 pl-5 text-base leading-7 text-foreground">
          <li>What happened, step by step, with dates and times</li>
          <li>How the scammer first contacted you, and who they pretended to be</li>
          <li>Whether you entered or shared any login, password, one-time code or token, and how</li>
          <li>How much was taken, and from which accounts or cards (bank account, debit card, credit card, e-wallet)</li>
          <li>Who you have already contacted (your bank or payment provider, the police, ScamShield) and when</li>
          <li>Any report or reference numbers from the bank or the police</li>
          <li>What the bank has said since, and whether you have a written reply</li>
        </ul>
      </details>
    </section>
  )
}
