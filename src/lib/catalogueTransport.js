import { fetchCataloguePages } from './cataloguePagination.js'
import { loadSnapshotRows, usesCatalogueSnapshots } from './catalogueSnapshot.js'

// The legacy reader is deliberately invoked only when the operator selects it.
// Data-file failures must not turn every visitor into a database export job.
export function fetchCatalogueDataset(dataset, createLegacyQuery) {
  return usesCatalogueSnapshots ? loadSnapshotRows(dataset) : fetchCataloguePages(createLegacyQuery)
}
