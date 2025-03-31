import { DurableObject } from "cloudflare:workers";

export default class UserContext extends DurableObject {
  clientIds: string[];
  orgSelections: Record<string, string | null>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.clientIds = [];
    this.orgSelections = {};
  }

  async addClientId(clientId: string, orgSlug: string | null) {
    if (this.clientIds.includes(clientId)) {
      return;
    }
    this.clientIds.push(clientId);
    this.orgSelections[clientId] = orgSlug;
  }

  async removeClientId(clientId: string) {
    this.clientIds = this.clientIds.filter((id) => id !== clientId);
  }

  async getClientIds() {
    return this.clientIds;
  }

  async getOrgSlug(clientId: string) {
    return this.orgSelections[clientId];
  }
}
