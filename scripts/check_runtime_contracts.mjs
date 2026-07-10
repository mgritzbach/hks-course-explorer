#!/usr/bin/env node

// CI-only executable contract check for pure frontend metadata/configuration.
// It intentionally imports no database client and performs no network I/O.
import { assertCourseMetaContract, buildCourseMeta } from '../src/lib/courseMeta.js'
import { assertScheduleNormalizationContract } from '../src/lib/scheduleCourseNormalization.js'
import { assertVisitorNavigationContract } from '../src/lib/visitorNavigation.js'
import schoolConfig, { assertSchoolConfig } from '../src/school.config.js'

try {
  assertCourseMetaContract(buildCourseMeta([]))
  assertScheduleNormalizationContract()
  assertVisitorNavigationContract()
  assertSchoolConfig(schoolConfig)
  console.log(
    'Runtime contracts: course metadata, schedule normalization, visitor navigation, and school configuration passed.',
  )
} catch (error) {
  console.error(`Runtime contract check failed: ${error.message}`)
  process.exitCode = 1
}
