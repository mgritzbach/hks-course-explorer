import { useEffect } from 'react'

/** Keep the browser and assistive-technology page title aligned with the active view. */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title
  }, [title])
}
