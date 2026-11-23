import type { AgentId, DataSourceKind, DeskSettings, DeskSnapshot } from "../types";

export type ActionResult = { ok: boolean; message: string };

/**
 * Everything the interface can ask the desk to do.
 *
 * The interface never signs transactions, never holds keys and never decides whether an order is allowed.
 * A data source forwards these requests to whoever owns that decision (the trading engine in production,
 * the simulator in demo mode) and reports back the result. Verification, trading limits and the emergency
 * stop are enforced by the engine, not by the browser.
 */
export interface DeskActions {
  closePosition(id: string): Promise<ActionResult>;
  setEmergencyStop(engaged: boolean, reason: string): Promise<ActionResult>;
  acknowledgeAlert(id: string): Promise<ActionResult>;
  /** Request a limit change. Sources must validate against hard ceilings. */
  updateLimit(key: string, value: number): Promise<ActionResult>;
  setAgentEnabled(id: AgentId, enabled: boolean): Promise<ActionResult>;
  markNotificationsRead(ids?: string[]): void;
  updateSettings(patch: Partial<Pick<DeskSettings, "notify" | "display">>): void;
}

export interface CoinDetail {
  noteMd: string | null;
  holders: { at: number; holders: number }[];
  events: { id: number; topic: string; at: number }[];
}

export interface DataSource {
  readonly kind: DataSourceKind;
  readonly label: string;
  /** True when no action can be sent from the interface. */
  readonly readOnly: boolean;
  fetchCoin?(mint: string): Promise<CoinDetail | null>;
  getSnapshot(): DeskSnapshot | null;
  subscribe(listener: () => void): () => void;
  /** Start/stop the live update stream. */
  setLive(on: boolean): void;
  actions: DeskActions;
}

/** Hard ceilings the interface will never request beyond (the engine enforces its own as well). */
export const LIMIT_CEILINGS: Record<string, number> = {
  max_position: 5000,
  daily_loss: 3000,
  open_positions: 12,
  token_exposure: 0.25,
  gross_exposure: 0.8,
  max_slippage: 300,
};
