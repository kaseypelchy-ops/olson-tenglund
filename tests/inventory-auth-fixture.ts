/** Test dependency only. The production app never imports this module. */
import { InventoryError } from '../lib/inventory/validation';

const authorizedRequests = new WeakMap<Request, string>();
export function authorizeInventoryTestRequest(request: Request) {
  authorizedRequests.set(request, 'staff:inventory-integration-fixture');
}
export async function requireAdminActor(request: Request): Promise<string> {
  const actor = authorizedRequests.get(request);
  if (!actor) throw new InventoryError('Sign in with an authorized staff account.', 401, 'auth_required');
  return actor;
}
