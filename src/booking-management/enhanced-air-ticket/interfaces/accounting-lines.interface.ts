/**
 * Used to control accounting line deletion prior ticketing.
 *
 * As a default logic, the API will always attempt to delete all accounting lines prior ticketing.
 *
 * However, if you wish the system to behave differently you may request to delete specific accounting line numbers only (`Number`, `EndNumber`) or prevent the deletion altogether: (`None`).
 */
export interface AccountingLines {
    Delete?: Delete[];
    /**
     * Used to delete all accounting lines, cannot combine with "None" attribute.
     * @example true
     */
    All?: boolean;
    /**
     * Used to indicate not to delete any of the accounting lines, cannot combine with "All" attribute.
     * @example false
     */
    None?: boolean;
}
/**
 * Used to specify accounting line numbers to be deleted.
 * @minItems 0
 */
export interface Delete {
    /**
     * Used with @Number to specify a range of accounting lines to delete.
     * @example 2
     */
    EndNumber?: number;
    /**
     * Used to specify particular accounting lines.
     * @example 1
     */
    Number: number;
}