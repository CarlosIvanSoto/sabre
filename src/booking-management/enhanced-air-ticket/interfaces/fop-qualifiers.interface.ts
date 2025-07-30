import { BasicFOP } from "./basic-fop.interface";
import { BSP_Ticketing } from "./bsp-ticketing.interface";
import { MultipleCC_FOP } from "./multicc-fop.interface";
import { SabreSonicTicketing } from "./sabre-sonic-ticketing.interface";

/** Used to pass form of payment related qualifiers. 
 * BasicFOP cannot combine with .../BSP_Ticketing, or .../SabreSonicTicketing, or .../Multiple CC_FOP. 
 **/
export interface FOP_Qualifiers {
    BasicFOP?: BasicFOP
    BSP_Ticketing?: BSP_Ticketing
    MultipleCC_FOP?: MultipleCC_FOP
    SabreSonicTicketing?: SabreSonicTicketing
}