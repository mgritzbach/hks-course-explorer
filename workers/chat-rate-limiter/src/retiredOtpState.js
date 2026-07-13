export const RETIRED_OTP_STORAGE_KEYS = Object.freeze([
  'otp',
  'otpCooldownUntil',
  'pendingOtpRequestId',
])

export function clearRetiredOtpState(storage) {
  return storage.delete(RETIRED_OTP_STORAGE_KEYS)
}
