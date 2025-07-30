import { CC_Info } from "./cc-info.interface";
import { Fare } from "./fare-interface.interface";
/** It cannot combine with .../BSP_Ticketing, or .../SabreSonicTicketing. */
export interface MultipleCC_FOP {
    /** Used to specify the amount to be applied to the second FOP. */
    Fare: Fare
    /** Used to specify first payment card details. */
    CC_One: CC_One
    /** Used to specify second payment card details. */
    CC_Two: CC_Two
}
/** Used to specify payment first card details. */
export interface CC_One {
    CC_Info: CC_Info
}
/** Used to specify payment second card details. */
export interface CC_Two extends CC_One {

}