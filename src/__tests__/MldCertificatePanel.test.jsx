import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import MldCertificatePanel from '../components/MldCertificatePanel.jsx'

describe('MldCertificatePanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('shows eligible progress, official sources, and persists minimization', () => {
    render(
      <MldCertificatePanel
        scheduledCourses={[{ courseCode: 'MLD-201-A', credits: 4 }]}
        completedCourses={[{ courseCode: 'DEV-210', credits: 4 }]}
        programId="MPA_2YR"
      />,
    )

    expect(screen.getByText('8 / 12 cr planned')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'HKS Hub ↗' }).getAttribute('href')).toBe(
      'https://hub.hks.harvard.edu/article/Certificate-in-Management-Leadership-and-Decision-Sciences',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))

    expect(screen.queryByText('Official requirements')).toBeNull()
    expect(window.localStorage.getItem('hks_mld_certificate_collapsed')).toBe('true')
  })
})
