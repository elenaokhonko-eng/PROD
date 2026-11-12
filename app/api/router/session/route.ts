import { createRouterSessionHandlers } from "./handlers"

const handlers = createRouterSessionHandlers()

export const POST = handlers.POST
export const GET = handlers.GET
export const PATCH = handlers.PATCH
