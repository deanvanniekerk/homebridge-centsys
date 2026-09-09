# homebridge-centsys

A Homebridge plugin in development for controlling CENTURION / CENTSYS gates from Apple Home, with open/close control and gate-state reporting.

**Status: cloud route selected; implementation pending.** The owner reports successful remote open/close through MyCentsys Remote outside nearby Bluetooth range. No installable plugin or third-party connection has been implemented or tested.

The intended accessory provides open/close requests and observed gate state through Homebridge on iHost. The next step is a read-only cloud client for authentication, device discovery and gate status. The exact controller model and firmware remain to be confirmed.

- [Feasibility assessment and proposed next steps](docs/FEASIBILITY.md)
- [Connectivity and existing protocol implementation research](docs/research/connectivity.md)
