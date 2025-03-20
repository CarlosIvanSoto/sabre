const PRICE_QUOTE_HANDLING_METHOD = {
  Reprice: "Reprice",
  Override: "Override",
  Quit: "Quit",
} as const

export type PriceQuoteHandlingMethodEnum = keyof typeof PRICE_QUOTE_HANDLING_METHOD;