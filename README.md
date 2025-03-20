# Sabre Node.js SDK

Node.js library for the Sabre API (REST).

## Install

```bash
npm install sabre-client
```

## Setup

First, you need to get an username, password and pcc which is available in the [DEV STUDIO - Applications](https://developer.sabre.com/my-account/applications).

```js
import { Sabre } from 'sabre-client';

const sabre = new Sabre({
  username: '773400', 
  password: 'PASSWORD_GOES_HERE',
  organization: '7TZA', // pcc
});
```

## Documentation

See http://developer.sabre.com

## Usage

Send the request for acquiring an authentication ATK session token.

```js
await sabre.authentication.OAuthTokenV2();
```

## Get booking

Displays comprehensive booking details irrespective of source, optionally narrowing down the response to selected elements.

```js
await sabre.booking.get({
  confirmationId: 'GLEBNY',
  returnOnly: [],
});
```

## Create booking

Creates an air booking (NDC/ATPCO/LCC).

```js
await sabre.booking.create(options);
```

## Modify Booking

Creates a list of booking items that need to be modified.

```js
await sabre.booking.modify(options);
```

## Cancel Booking

Cancels a booking or specified booking items, optionally voiding or refunding related flight tickets.

```js
await sabre.booking.cancel(options);
```

## Void Flight Tickets

Voids tickets with ticket numbers listed in the request, optionally including nonelectronic tickets (paper).

```js
await sabre.flightTickets.void(options);
```

## Refund Flight Tickets

Processes tickets by providing a request containing a list of ticket numbers which should be refunded. EMDs are currently not supported.

```js
await sabre.flightTickets.refund(options);
```

## Check Flight Tickets

Checks tickets with ticket numbers listed in the request for void, refund and exchange conditions. EMDs are currently not supported.

```js
await sabre.flightTickets.check(options);
```

## Development

#### Install dependencies

```sh
npm install
```

#### Build and run packages

```sh
npm dev
```

## Authors

- Carlos Ivan Soto ([carlosivansotop](https://www.linkedin.com/in/carlosivansotop/))

## License

MIT License