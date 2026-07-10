import { describe, expect, it } from 'vitest'
import { ADMIN_UPLOAD_CONFIG, getUploadReadiness } from '../pages/Admin.jsx'

describe('Admin upload readiness', () => {
  const bidding = ADMIN_UPLOAD_CONFIG.find((config) => config.key === 'bidding')

  it('allows a normalized human-header workbook with the required fields', () => {
    expect(
      getUploadReadiness(bidding, {
        file: { name: 'bidding.xlsx' },
        headers: ['course_code', 'bid_clearing_price'],
        rows: [{ course_code: 'API-101', bid_clearing_price: 10 }],
      }),
    ).toMatchObject({ canUpload: true, missingRequiredColumns: [] })
  })

  it('keeps Confirm upload disabled when a required field is absent', () => {
    expect(
      getUploadReadiness(bidding, {
        file: { name: 'bidding.xlsx' },
        headers: ['course_code'],
        rows: [{ course_code: 'API-101' }],
      }),
    ).toMatchObject({ canUpload: false, missingRequiredColumns: ['bid_clearing_price'] })
  })
})
