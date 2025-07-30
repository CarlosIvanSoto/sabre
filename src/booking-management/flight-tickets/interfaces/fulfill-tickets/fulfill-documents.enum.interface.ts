const FUL_FILL_DOCUMENTS_ENUM = {
  Invoice: "Invoice",
  Electronic_Ticketing_Receipt: "Electronic Ticketing Receipt",
  All: "All"
} as const

export type FulFillDocumentsEnum = keyof typeof FUL_FILL_DOCUMENTS_ENUM;