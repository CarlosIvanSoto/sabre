/**
 * Contains details of the traveler's full name.
 */
export interface TravelerName {
    /** 
     * pattern:^[^\s]+(\s[^\s]+)*$
     * example:John
     * The traveler's first name.
    */
    givenName: string
    /** 
     * example:John
     * The traveler's middle name.
    */
    middleName?: string
    /** 
     * pattern:^[^\s]+(\s[^\s]+)*$
     * example:Smith
     * The traveler's last name.
    */
    surname: string
}