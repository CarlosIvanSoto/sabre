/**
 * Lists specific information from the system and/or other sub-systems invoked during processing.
 * @maxItems 99
 * @minItems 0
 */
export type SystemSpecificResults = {
  /** Contains the host system command run to create this result. */
  HostCommand?: {
    /**
     * @minLength 0
     * @maxLength 4096
     */
    content?: string;
    /**
     * An abbreviation for Line / Interface Adapter / Terminal Address.
     *
     * It is a 3-byte terminal address, usually seen as a 6-character hexadecimal field.
     * @example "0358DC"
     */
    LNIATA?: string;
  };
  /**
   * Lists application-specific codes and messages.
   *
   * Refers to a text-based description that provides more information about a specific condition, warning, or error, and is accompanied by a code attribute as a numeric value.
   * @maxItems 99
   * @minItems 0
   */
  Message?: {
    /**
     * @minLength 0
     * @maxLength 4096
     */
    content?: string;
    code?: string;
  }[];
  /**
   * An abbreviated version of the error in textual format.
   * @minLength 1
   * @maxLength 128
   */
  ShortText?: string;
  /**
   * If present, this attribute may identify an unknown or misspelled tag that caused an error in processing.
   * It is recommended that the Tag attribute use XPath notation to identify the location of a tag in the event
   * that more than one tag of the same name is present in the document.
   * Alternatively, the tag name alone can be used to identify missing data [Type=ReqFieldMissing].
   * @minLength 0
   * @maxLength 4096
   */
  Element?: string;
  /**
   * If present, this attribute allows for batch processing and the identification of the record that failed amongst a group of records.
   * This value may contain a concatenation of a unique failed transaction ID with specific record(s) associated with that transaction.
   * @minLength 1
   * @maxLength 255
   */
  RecordID?: string;
  /** If present, this attribute refers to an online description of the error that occurred. */
  DocURL?: string;
  timeStamp?: string;
  /** If present, this attribute provides an XML IDREF to the element for which the results apply. */
  reference?: string;
}[];