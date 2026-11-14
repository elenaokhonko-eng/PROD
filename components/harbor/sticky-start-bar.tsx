'use client'

import { useEffect, useState } from 'react'
import { StartEvaluationButton } from '@/components/harbor/start-evaluation-button'

// Brief W1 §A4: on phones, a slim bar with the primary button once the visitor has scrolled past the story box. It
// hides while the story box or the footer is on screen, so it never covers the footer's contact links. It appears
// without animation, which also suits reduced motion and Quiet mode.
export function StickyStartBar({ storyId = 'tell-your-story' }: { storyId?: string }) {
  const [pastStory, setPastStory] = useState(false)
  const [footerVisible, setFooterVisible] = useState(false)

  useEffect(() => {
    const story = document.getElementById(storyId)
    const footer = document.querySelector('footer')
    if (!story) return
    const storyObserver = new IntersectionObserver(([entry]) => {
      setPastStory(!entry.isIntersecting && entry.boundingClientRect.bottom < 0)
    })
    storyObserver.observe(story)
    const footerObserver = footer ? new IntersectionObserver(([entry]) => setFooterVisible(entry.isIntersecting)) : null
    if (footer) footerObserver?.observe(footer)
    return () => {
      storyObserver.disconnect()
      footerObserver?.disconnect()
    }
  }, [storyId])

  if (!pastStory || footerVisible) return null
  return (
    <div
      data-testid="sticky-start-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden"
    >
      <StartEvaluationButton className="w-full" />
    </div>
  )
}
