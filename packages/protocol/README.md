# @portixone/protocol

Source of truth for the message contract between the Portix Runtime and its SDKs (`PrintJob`, `Capability`, WebSocket events). Consumed today by `runtime` and [`@portix/sdk`](https://www.npmjs.com/package/@portix/sdk).

Once non-JS SDKs exist (`sdk-dotnet`, `sdk-python`, `sdk-go`), this package is a candidate to become a spec (JSON Schema / OpenAPI) that generates types per language, instead of staying pure TypeScript.

This is an internal dependency of `@portix/sdk` and the runtime — most developers won't import it directly.
