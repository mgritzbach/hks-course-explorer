const historicalCourses = [
  {
    id: 'history-api-101-2024',
    course_code: 'API-101',
    course_code_base: 'API-101',
    course_name: 'Policy Analysis Foundations',
    professor_display: 'Avery Analyst',
    credits_min: 4,
    year: 2024,
    term: 'Fall',
    has_eval: true,
    has_bidding: true,
    last_bid_price: 540,
    bid_clearing_price: 540,
    bid_capacity: 32,
    bid_n_bids: 38,
    is_average: false,
    metrics_pct: { Instructor_Rating: 79, Course_Rating: 75, Workload: 60 },
    metrics_raw: { Instructor_Rating: 4.0, Course_Rating: 3.8, Workload: 3.0 },
  },
  {
    id: 'history-api-101',
    course_code: 'API-101',
    course_code_base: 'API-101',
    course_name: 'Policy Analysis Foundations',
    professor_display: 'Avery Analyst',
    credits_min: 4,
    year: 2025,
    term: 'Spring',
    has_eval: true,
    has_bidding: true,
    last_bid_price: 650,
    bid_clearing_price: 650,
    bid_capacity: 30,
    bid_n_bids: 44,
    is_average: false,
    metrics_pct: { Instructor_Rating: 81, Course_Rating: 78, Workload: 62 },
    metrics_raw: { Instructor_Rating: 4.1, Course_Rating: 3.9, Workload: 3.1 },
  },
  {
    id: 'history-bgp-201',
    course_code: 'BGP-201',
    course_code_base: 'BGP-201',
    course_name: 'Economics for Public Policy',
    professor_display: 'Evan Economist',
    credits_min: 4,
    year: 2025,
    term: 'Spring',
    has_eval: true,
    has_bidding: true,
    last_bid_price: 425,
    is_average: false,
    metrics_pct: { Instructor_Rating: 76, Course_Rating: 74, Workload: 58 },
    metrics_raw: { Instructor_Rating: 3.8, Course_Rating: 3.7, Workload: 2.9 },
  },
]

const liveCourses = [
  {
    id: 'live-api-101',
    course_code: 'API-101',
    course_code_base: 'API-101',
    title: 'Policy Analysis Foundations',
    term: '2026 Spring',
    credits: 4,
    instructors: ['Avery Analyst'],
    meeting_days: 'MON/WED',
    time_start: '09:00',
    time_end: '10:15',
    location: 'Littauer 101',
    school: 'HKS',
    is_hks: true,
    session_code: 'SPR1',
    session_description: 'Spring 1',
    cross_reg_eligible: 'YESXREG',
  },
  {
    id: 'live-bgp-201',
    course_code: 'BGP-201',
    course_code_base: 'BGP-201',
    title: 'Economics for Public Policy',
    term: '2026 Spring',
    credits: 4,
    instructors: ['Evan Economist'],
    meeting_days: 'TUE/THU',
    time_start: '11:00',
    time_end: '12:15',
    location: 'Taubman 201',
    school: 'HKS',
    is_hks: true,
    session_code: 'SPR2',
    session_description: 'Spring 2',
    cross_reg_eligible: 'YESXREG',
  },
  {
    id: 'live-econ-50',
    course_code: 'ECON-50',
    course_code_base: 'ECON-50',
    title: 'Public Economics',
    term: '2026 Spring',
    credits: 4,
    instructors: ['Nora Numbers'],
    meeting_days: 'MON',
    time_start: '14:00',
    time_end: '15:15',
    location: 'Sever 102',
    school: 'FAS',
    is_hks: false,
    session_code: 'FULL',
    session_description: 'Full Term',
    cross_reg_eligible: 'YESXREG',
  },
]

const catalogueResults = [
  {
    harvardId: 'api-101-search',
    courseCode: 'API-101',
    title: 'Policy Analysis Foundations',
    term: '2026 Spring',
    credits: 4,
    instructors: ['Avery Analyst'],
    sessionDescription: 'Spring 1',
    crossRegEligible: 'YESXREG',
    sections: [
      {
        sectionId: 'main',
        meeting_days: 'MON/WED',
        time_start: '09:00',
        time_end: '10:15',
        location: 'Littauer 101',
      },
    ],
  },
]

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  })
}

/**
 * Isolate browser tests from Supabase and Harvard. The app still exercises its
 * real fetch, route, normalization, filtering, and rendering code; only the
 * mutable network boundary is replaced by a compact representative fixture.
 */
export async function installMockBackend(page, { harvardResponse } = {}) {
  // The client requests catalogue pages in parallel. Returning the compact
  // fixture exactly once models a populated first page without coupling tests
  // to a transport-specific Range header spelling or request ordering.
  let historicalPageServed = false
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname

    if (pathname.endsWith('/courses')) {
      const pageData = historicalPageServed ? [] : historicalCourses
      historicalPageServed = true
      return json(route, pageData)
    }
    if (pathname.endsWith('/live_courses')) return json(route, liveCourses)
    if (pathname.endsWith('/course_sections')) return json(route, [])

    return json(route, [])
  })

  await page.route('**/api/harvard-courses**', (route) =>
    json(
      route,
      harvardResponse || {
        results: catalogueResults,
        total: catalogueResults.length,
      },
    ),
  )

  // Analytics must never make a local regression test depend on an external
  // collector. Aborting is intentional: product behavior is unaffected.
  await page.route('https://*.posthog.com/**', (route) => route.abort())
}
