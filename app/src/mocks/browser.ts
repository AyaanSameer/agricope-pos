import { setupWorker } from 'msw/browser'
import { seedWorld } from './seed'
import { orgHandlers } from './orgHandlers'
import { adminHandlers } from './adminHandlers'
import { orderHandlers } from './orderHandlers'
import { serviceHandlers } from './serviceHandlers'
import { shiftHandlers } from './shiftHandlers'

// One in-memory world per page load — restarting the page reseeds it.
seedWorld()

export const worker = setupWorker(
  ...orgHandlers,
  ...adminHandlers,
  ...orderHandlers,
  ...serviceHandlers,
  ...shiftHandlers,
)
