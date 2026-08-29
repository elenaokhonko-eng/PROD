'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Mic, Pause, Play, Square, Trash2, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createRouterSession, getSessionToken, updateRouterSession } from '@/lib/router-session'
import { trackClientEvent } from '@/lib/analytics/client'
import { persistPendingNarrative, readPendingNarrative } from '@/components/landing/hero-capture'

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

    if (navigator.onLine && !getSessionToken()) {
      void createRouterSession().catch(() => {
        setError('The complaint helper could not start. Check your connection and try again.')
      })
    }

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
      setError('Tell Lumi a little about what happened before continuing.')
      return
    }
    if (!isOnline) {
      setError('You’re offline. Your story is saved on this device; reconnect before continuing.')
      return
    }
    setError(null)
    setIsProcessing(true)
    try {
      let sessionToken = getSessionToken()
      if (!sessionToken) {
        await createRouterSession()
        sessionToken = getSessionToken()
      }
      if (!sessionToken) throw new Error('No session token found')
      await updateRouterSession(sessionToken, { dispute_narrative: narrative.trim() })
      persistPendingNarrative({ narrative: narrative.trim(), transcript: inputMethod === 'voice' ? narrative.trim() : undefined })
      await trackClientEvent({
        eventName: 'story_submitted',
        sessionId: sessionToken,
        pageUrl: window.location.href,
        eventData: { narrative_length: narrative.trim().length, input_method: inputMethod },
      })
      router.push('/router/classify')
    } catch {
      setError('Your story could not be saved. It is still here — check your connection and try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <section className="gb-card p-5 sm:p-7" aria-labelledby="capture-title" aria-busy={isProcessing || isTranscribing}>
      <h2 id="capture-title" className="text-2xl font-semibold text-harbor-deep">
        Tell Lumi what happened — in your own words.
      </h2>
      <p className="mt-2 leading-6 text-muted-foreground">There is no wrong way to begin. You can edit your words before continuing.</p>

      {!isOnline && (
        <div className="mt-4 flex gap-2 rounded-xl border border-harbor-gold/50 bg-harbor-gold-wash p-3 text-sm leading-6" role="status">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>You’re offline. Your unfinished story stays on this device and can be submitted after you reconnect.</span>
        </div>
      )}
      {restoredDraft && (
        <p className="mt-4 rounded-xl bg-harbor-sage-tint p-3 text-sm leading-6" role="status">
          Your unfinished story was restored from this device.
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
        <Textarea
          id="story"
          value={narrative}
          onChange={(event) => setNarrative(event.target.value)}
          rows={8}
          aria-describedby="story-help story-privacy"
          placeholder="For example: In March, I received a call that looked like it was from my bank…"
          className="min-h-48 resize-y bg-card text-base leading-7"
        />
        <p id="story-help" className="mt-2 text-sm text-muted-foreground">
          Helpful details include what happened, when it happened, amounts, contacts and reference numbers.
        </p>
        <p id="story-privacy" className="mt-3 rounded-lg bg-harbor-sage-tint px-3 py-2 text-sm leading-6">
          An unfinished story is retained in this browser so you can return to it. Voice is sent for transcription when you stop recording.
        </p>
      </div>

      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-harbor-error-tint p-4 text-sm">
          {error}
        </div>
      )}

      <details className="mt-4 rounded-xl border bg-card p-4">
        <summary className="min-h-11 cursor-pointer font-medium">What should I include?</summary>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
          <li>What happened and when</li>
          <li>Amounts involved</li>
          <li>Who you already contacted</li>
          <li>Any reference numbers</li>
        </ul>
      </details>

      <Button type="button" size="lg" className="mt-5 w-full" disabled={isProcessing || isTranscribing || isRecording || !isOnline} onClick={() => void submitNarrative()}>
        {isProcessing && <Loader2 className="animate-spin" aria-hidden="true" />}
        {isProcessing ? 'Saving your story…' : 'Start organising — free'}
      </Button>
    </section>
  )
}
