// El sample de response oficial de Get Itinerary History (`TravelItineraryHistoryLLSRQ`, developer.sabre.com/soap-api/get-itinerary-history),
// tal cual (raw/sources/get-itinerary-history.md del wiki). Trae `<GeneralInfo><Text>INVOICE</Text></GeneralInfo>` sin Action en los RPH 1, 2 y 5.
export const OFFICIAL_HISTORY_SAMPLE = `<TravelItineraryHistoryRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:stl="http://services.sabre.com/STL/v01" Version="2.3.0">
	<stl:ApplicationResults status="Complete">
		<stl:Success timeStamp="2026-01-30T10:00:00Z">
			<stl:SystemSpecificResults>
				<stl:HostCommand LNIATA="464FEA">JX HST*KBGQBN</stl:HostCommand>
			</stl:SystemSpecificResults>
		</stl:Success>
	</stl:ApplicationResults>
	<HistoricalInfo RPH="1">
		<AccountingInfo Action="AAC">
			<Airline Code="AA"/>
			<BaseFare Amount="150.00"/>
			<DocumentInfo>
				<Document Number="8321351727"/>
			</DocumentInfo>
			<PaymentInfo>
				<Commission Percent="0.00"/>
				<FareApplication>ONE</FareApplication>
				<Payment>
					<Form>CA</Form>
				</Payment>
			</PaymentInfo>
			<PersonName NameNumber="1.1">TEST WEBSERVICES</PersonName>
			<Taxes>
				<Tax Amount="0.00"/>
			</Taxes>
			<Text>MD</Text>
			<TicketingInfo>
				<Exchange Ind="false"/>
				<TarriffBasis>I</TarriffBasis>
				<Ticketing ConjunctedCount="1"/>
			</TicketingInfo>
		</AccountingInfo>
		<GeneralInfo>
			<Text>INVOICE</Text>
		</GeneralInfo>
		<GeneralInfo Action="A7">
			<Text>ME 0018321351727-AT TEST/W IH9A*H.I 0635/30JAN*S</Text>
		</GeneralInfo>
		<GeneralInfo Action="AT">
			<Text>WEMD*AE2FCASHKP0</Text>
		</GeneralInfo>
		<ItineraryRef>
			<Source AAA_PseudoCityCode="IH9A" CreateDateTime="2026-01-30T06:35" CreationAgent=".I" CreationAgentDutyCode="*" CreationAgentFunctionCode="H" PseudoCityCode="FSG"/>
		</ItineraryRef>
	</HistoricalInfo>
	<HistoricalInfo RPH="2">
		<AccountingInfo Action="AAC">
			<Airline Code="AA"/>
			<BaseFare Amount="200.00"/>
			<DocumentInfo>
				<Document Number="8321351726"/>
			</DocumentInfo>
			<PaymentInfo>
				<Commission Percent="0.00"/>
				<FareApplication>ONE</FareApplication>
				<Payment>
					<Form>CA</Form>
				</Payment>
			</PaymentInfo>
			<PersonName NameNumber="1.1">TEST WEBSERVICES</PersonName>
			<Taxes>
				<Tax Amount="0.00"/>
			</Taxes>
			<Text>MD</Text>
			<TicketingInfo>
				<Exchange Ind="false"/>
				<TarriffBasis>I</TarriffBasis>
				<Ticketing ConjunctedCount="1"/>
			</TicketingInfo>
		</AccountingInfo>
		<GeneralInfo>
			<Text>INVOICE</Text>
		</GeneralInfo>
		<GeneralInfo Action="A7">
			<Text>ME 0018321351726-AT TEST/W IH9A*H.I 0622/30JAN*S</Text>
		</GeneralInfo>
		<GeneralInfo Action="AT">
			<Text>WEMD*AE1FCASHKP0</Text>
		</GeneralInfo>
		<ItineraryRef>
			<Source AAA_PseudoCityCode="IH9A" CreateDateTime="2026-01-30T06:22" CreationAgent=".I" CreationAgentDutyCode="*" CreationAgentFunctionCode="H" PseudoCityCode="FSG"/>
		</ItineraryRef>
	</HistoricalInfo>
	<HistoricalInfo RPH="3">
		<ItineraryInfo>
			<ReservationItems>
				<Item RPH="1">
					<FlightSegment Action="AS" ArrivalDateTime="03-01T13:54" DepartureDateTime="03-01T12:19" FlightNumber="2528" NumberInParty="01" ResBookDesigCode="Y" Status="SSNN" eTicket="true">
						<DestinationLocation LocationCode="LAX"/>
						<MarketingAirline Code="AA" FlightNumber="2528"/>
						<OriginLocation LocationCode="DFW"/>
						<SupplierRef ID="DCAA"/>
					</FlightSegment>
					<FlightSegment Action="AS" ArrivalDateTime="03-06T14:32" DepartureDateTime="03-06T09:30" FlightNumber="1180" NumberInParty="01" ResBookDesigCode="Y" Status="SSNN" eTicket="true">
						<DestinationLocation LocationCode="DFW"/>
						<MarketingAirline Code="AA" FlightNumber="1180"/>
						<OriginLocation LocationCode="LAX"/>
						<SupplierRef ID="DCAA"/>
					</FlightSegment>
				</Item>
			</ReservationItems>
		</ItineraryInfo>
		<ItineraryRef>
			<Source AAA_PseudoCityCode="IH9A" CreateDateTime="2026-01-30T06:17" CreationAgent=".I" CreationAgentDutyCode="*" CreationAgentFunctionCode="H" PseudoCityCode="FSG" ReceivedFrom="FSG"/>
		</ItineraryRef>
	</HistoricalInfo>
	<HistoricalInfo RPH="4">
		<GeneralInfo Action="X3S">
			<Text>SSR TKNE AA HK1 DFWLAX2528Y01MAR/0017243037967C1</Text>
		</GeneralInfo>
		<GeneralInfo Action="X3S">
			<Text>SSR TKNE AA HK1 LAXDFW1180Y06MAR/0017243037967C2</Text>
		</GeneralInfo>
		<GeneralInfo Action="A7">
			<Text>TV 0017243037967-AT  *VOID* IH9A*AAY 0030/30JAN*E</Text>
		</GeneralInfo>
		<ItineraryInfo>
			<ReservationItems>
				<Item RPH="1">
					<FlightSegment Action="XS" ArrivalDateTime="03-01T13:54" DepartureDateTime="03-01T12:19" FlightNumber="2528" NumberInParty="01" ResBookDesigCode="Y" Status="HKNN" eTicket="true">
						<DestinationLocation LocationCode="LAX"/>
						<MarketingAirline Code="AA" FlightNumber="2528"/>
						<OriginLocation LocationCode="DFW"/>
						<SupplierRef ID="DCAA*KJEKOD"/>
					</FlightSegment>
					<FlightSegment Action="XS" ArrivalDateTime="03-06T14:32" DepartureDateTime="03-06T09:30" FlightNumber="1180" NumberInParty="01" ResBookDesigCode="Y" Status="HKNN" eTicket="true">
						<DestinationLocation LocationCode="DFW"/>
						<MarketingAirline Code="AA" FlightNumber="1180"/>
						<OriginLocation LocationCode="LAX"/>
						<SupplierRef ID="DCAA*KJEKOD"/>
					</FlightSegment>
				</Item>
			</ReservationItems>
		</ItineraryInfo>
		<ItineraryRef>
			<Source AAA_PseudoCityCode="IH9A" CreateDateTime="2026-01-30T00:30" CreationAgent="AY" CreationAgentDutyCode="*" CreationAgentFunctionCode="A" PseudoCityCode="IH9A" ReceivedFrom="SWS TEST"/>
		</ItineraryRef>
	</HistoricalInfo>
	<HistoricalInfo RPH="5">
		<AccountingInfo Action="AAC">
			<Airline Code="AA"/>
			<BaseFare Amount="1240.94"/>
			<DocumentInfo>
				<Document Number="7243037967"/>
			</DocumentInfo>
			<PaymentInfo>
				<Commission Amount="0.00"/>
				<FareApplication>ONE</FareApplication>
				<Payment>
					<Form>CA</Form>
				</Payment>
			</PaymentInfo>
			<PersonName NameNumber="1.1">TEST WEBSERVICES</PersonName>
			<Taxes>
				<Tax Amount="123.87"/>
			</Taxes>
			<TicketingInfo>
				<Exchange Ind="false"/>
				<TarriffBasis>D</TarriffBasis>
				<Ticketing ConjunctedCount="1"/>
			</TicketingInfo>
		</AccountingInfo>
		<GeneralInfo>
			<Text>INVOICE</Text>
		</GeneralInfo>
		<GeneralInfo Action="A3S">
			<Text>SSR TKNE AA HK1 DFWLAX2528Y01MAR/0017243037967C1</Text>
		</GeneralInfo>
		<GeneralInfo Action="A3S">
			<Text>SSR TKNE AA HK1 LAXDFW1180Y06MAR/0017243037967C2</Text>
		</GeneralInfo>
		<GeneralInfo Action="X7">
			<Text>T-A</Text>
		</GeneralInfo>
		<GeneralInfo Action="A7">
			<Text>T-30JAN-IH9A*AAY</Text>
		</GeneralInfo>
		<GeneralInfo Action="AT">
			<Text>WETRAAA</Text>
		</GeneralInfo>
		<ItineraryRef>
			<Source AAA_PseudoCityCode="IH9A" CreateDateTime="2026-01-30T00:29" CreationAgent="AY" CreationAgentDutyCode="*" CreationAgentFunctionCode="A" PseudoCityCode="IH9A" ReceivedFrom="SWS TEST"/>
		</ItineraryRef>
	</HistoricalInfo>
	<HistoricalInfo RPH="6">
		<GeneralInfo Action="A9">
			<Text>DFW817-555-1212-H-1.1</Text>
		</GeneralInfo>
		<GeneralInfo Action="AW">
			<Text>SABRE TRAVEL</Text>
		</GeneralInfo>
		<GeneralInfo Action="AW">
			<Text>3150 SABRE DRIVE</Text>
		</GeneralInfo>
		<GeneralInfo Action="AW">
			<Text>SOUTHLAKE, TX US</Text>
		</GeneralInfo>
		<GeneralInfo Action="AW">
			<Text>76092</Text>
		</GeneralInfo>
		<GeneralInfo Action="A3S">
			<Text>SSR DOCS AA HK1/DB/01JAN01/M/TEST/WEBSERVICES</Text>
		</GeneralInfo>
		<GeneralInfo Action="A5F">
			<Text>CK</Text>
		</GeneralInfo>
		<GeneralInfo Action="AN">
			<Text>1TEST/WEBSERVICES*ABC123</Text>
		</GeneralInfo>
		<GeneralInfo Action="A7">
			<Text>T-A</Text>
		</GeneralInfo>
		<GeneralInfo Action="APE">
			<Text>EWEBSERVICES.TEST@SABRE.COMTO</Text>
		</GeneralInfo>
		<GeneralInfo Action="ADT">
			<Text>TADT</Text>
		</GeneralInfo>
		<ItineraryInfo>
			<ReservationItems>
				<Item RPH="1">
					<FlightSegment Action="AS" ArrivalDateTime="03-01T13:54" DepartureDateTime="03-01T12:19" FlightNumber="2528" NumberInParty="01" ResBookDesigCode="Y" Status="SSNN" eTicket="true">
						<DestinationLocation LocationCode="LAX"/>
						<MarketingAirline Code="AA" FlightNumber="2528"/>
						<OriginLocation LocationCode="DFW"/>
						<SupplierRef ID="DCAA"/>
					</FlightSegment>
					<FlightSegment Action="AS" ArrivalDateTime="03-06T14:32" DepartureDateTime="03-06T09:30" FlightNumber="1180" NumberInParty="01" ResBookDesigCode="Y" Status="SSNN" eTicket="true">
						<DestinationLocation LocationCode="DFW"/>
						<MarketingAirline Code="AA" FlightNumber="1180"/>
						<OriginLocation LocationCode="LAX"/>
						<SupplierRef ID="DCAA"/>
					</FlightSegment>
				</Item>
			</ReservationItems>
		</ItineraryInfo>
		<ItineraryRef>
			<Source AAA_PseudoCityCode="IH9A" CreateDateTime="2026-01-30T00:29" CreationAgent="AY" CreationAgentDutyCode="*" CreationAgentFunctionCode="A" PseudoCityCode="IH9A" ReceivedFrom="SWS TEST"/>
		</ItineraryRef>
	</HistoricalInfo>
</TravelItineraryHistoryRS>`;
