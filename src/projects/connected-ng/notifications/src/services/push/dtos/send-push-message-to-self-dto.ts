export interface SendPushMessageToSelfDto {
  title: string;
  body: string;
  url?: string;
  // Looked up by the receiving worker against whatever map the app last posted it, in the reader's
  // own language. Omit it to see title/body exactly as sent, unlocalized - useful for this endpoint's
  // own purpose of trying delivery end to end.
  key?: string;
}
