# Security policy

## Supported version

Only the current production commit on `master` receives security fixes. Older
deployments and forks must update to the latest reviewed release before support.

## Report a vulnerability privately

Use GitHub's enabled
[private vulnerability report](https://github.com/mgritzbach/hks-course-explorer/security/advisories/new)
for suspected vulnerabilities, exposed credentials, authorization failures,
or unintended access to student/provider data.

Do not put secrets, tokens, student data, exploit details, or raw provider
responses in a public issue. For a non-sensitive defect, use GitHub Issues. If
private reporting is temporarily unavailable, open a public issue containing
only a request for private contact and no vulnerability details.

Include the affected URL or component, observed impact, safe reproduction
steps, and the approximate time of observation. The project currently has one
maintainer and no 24/7 SLA; high-impact reports are prioritized, production
promotion is frozen during investigation, and fixes still require the complete
protected release gate.
