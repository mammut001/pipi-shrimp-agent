/**
 * Telegram-related type definitions
 * For the pipi-shrimp-agent IM connector
 */

// ============= Connection State =============

/** Telegram connection states */
export type TelegramConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'reconnecting';

// ============= User & Chat Types =============

/** Telegram user (from message sender) */
export interface TelegramUser {
  id: number;
  isBot: boolean;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}

/** Telegram chat */
export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/** Message entity (for commands, mentions, etc.) */
export interface TelegramMessageEntity {
  type: 'bot_command' | 'mention' | 'hashtag' | 'url' | 'text_link' | 'text_mention' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'pre' | 'text_mention';
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
  language?: string;
}

// ============= Message Types =============

/** Incoming message from Telegram */
export interface TelegramMessage {
  messageId: number;
  messageThreadId?: number;
  from?: TelegramUser;
  senderChat?: TelegramChat;
  chat: TelegramChat;
  date: number;
  editDate?: number;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  captionEntities?: TelegramMessageEntity[];
  photo?: TelegramPhoto[];
  document?: TelegramDocument;
  sticker?: TelegramSticker;
  video?: TelegramVideo;
  voice?: TelegramVoice;
  location?: TelegramLocation;
  contact?: TelegramContact;
  newChatMembers?: TelegramUser[];
  leftChatMember?: TelegramUser;
  newChatTitle?: string;
  newChatPhoto?: TelegramPhoto[];
  deleteChatPhoto?: boolean;
  groupChatCreated?: boolean;
  supergroupChatCreated?: boolean;
  channelChatCreated?: boolean;
  migrateToChatId?: number;
  migrateFromChatId?: number;
  pinnedMessage?: TelegramMessage;
  invoice?: TelegramInvoice;
  successfulPayment?: TelegramSuccessfulPayment;
  connectedWebsite?: string;
  passportData?: TelegramPassportData;
  proximityAlertTriggered?: TelegramProximityAlertTriggered;
  forumTopicCreated?: TelegramForumTopicCreated;
  forumTopicEdited?: TelegramForumTopicEdited;
  forumTopicClosed?: TelegramForumTopicClosed;
  forumTopicReopened?: TelegramForumTopicReopened;
  videoChatScheduled?: TelegramVideoChatScheduled;
  videoChatStarted?: TelegramVideoChatStarted;
  videoChatEnded?: TelegramVideoChatEnded;
  videoChatParticipantsInvited?: TelegramVideoChatParticipantsInvited;
  webAppData?: TelegramWebAppData;
  replyToMessage?: TelegramMessage;
  isAutomaticForward?: boolean;
}

/** Basic photo size */
export interface TelegramPhoto {
  fileId: string;
  fileUniqueId: string;
  width: number;
  height: number;
  fileSize?: number;
}

/** Document (file) */
export interface TelegramDocument {
  fileId: string;
  fileUniqueId: string;
  thumbnail?: TelegramPhoto;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
}

/** Sticker */
export interface TelegramSticker {
  fileId: string;
  fileUniqueId: string;
  width: number;
  height: number;
  isAnimated: boolean;
  isVideo: boolean;
  thumbnail?: TelegramPhoto;
  emoji?: string;
  setName?: string;
  maskPosition?: TelegramMaskPosition;
}

/** Video */
export interface TelegramVideo {
  fileId: string;
  fileUniqueId: string;
  width: number;
  height: number;
  duration: number;
  thumbnail?: TelegramPhoto;
  mimeType?: string;
  fileSize?: number;
}

/** Voice message */
export interface TelegramVoice {
  fileId: string;
  fileUniqueId: string;
  duration: number;
  mimeType?: string;
  fileSize?: number;
}

/** Location */
export interface TelegramLocation {
  longitude: number;
  latitude: number;
  horizontalAccuracy?: number;
  livePeriod?: number;
  heading?: number;
  proximityAlertRadius?: number;
}

/** Contact */
export interface TelegramContact {
  phoneNumber: string;
  firstName: string;
  lastName?: string;
  userId?: number;
  vcard?: string;
}

// ============= Bot Info =============

/** Bot information from getMe API */
export interface TelegramBotInfo {
  id: number;
  isBot: boolean;
  firstName: string;
  lastName?: string;
  username: string;
  canJoinGroups: boolean;
  canReadAllGroupMessages: boolean;
  supportsInlineQueries: boolean;
  canConnectToBusiness: boolean;
  hasMainWebApp: boolean;
}

// ============= Update Types =============

/** Update from getUpdates API */
export interface TelegramUpdate {
  updateId: number;
  message?: TelegramMessage;
  editedMessage?: TelegramMessage;
  channelPost?: TelegramMessage;
  editedChannelPost?: TelegramMessage;
  inlineQuery?: TelegramInlineQuery;
  chosenInlineResult?: TelegramChosenInlineResult;
  callbackQuery?: TelegramCallbackQuery;
  shippingQuery?: TelegramShippingQuery;
  preCheckoutQuery?: TelegramPreCheckoutQuery;
  poll?: TelegramPoll;
  pollAnswer?: TelegramPollAnswer;
  myChatMember?: TelegramChatMemberUpdated;
  chatMember?: TelegramChatMemberUpdated;
  chatJoinRequest?: TelegramChatJoinRequest;
}

/** Inline query */
export interface TelegramInlineQuery {
  id: string;
  from: TelegramUser;
  query: string;
  offset: string;
  chatType?: string;
  location?: TelegramLocation;
}

/** Chosen inline result */
export interface TelegramChosenInlineResult {
  resultId: string;
  from: TelegramUser;
  query: string;
  location?: TelegramLocation;
  inlineMessageId?: string;
}

/** Callback query */
export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  chatInstance?: string;
  data?: string;
  gameShortName?: string;
  message?: TelegramMessage;
}

// ============= Additional Types =============

/** Mask position for stickers */
export interface TelegramMaskPosition {
  point: 'forehead' | 'eyes' | 'mouth' | 'chin' | 'nose';
  scale: number;
  xShift?: number;
  yShift?: number;
}

/** Invoice */
export interface TelegramInvoice {
  title: string;
  description: string;
  startParameter: string;
  currency: string;
  totalAmount: number;
}

/** Successful payment */
export interface TelegramSuccessfulPayment {
  currency: string;
  totalAmount: number;
  invoicePayload: string;
  telegramPaymentChargeId: string;
  providerPaymentChargeId: string;
}

/** Passport data */
export interface TelegramPassportData {
  data: TelegramEncryptedCredentials[];
  credentials: TelegramEncryptedCredentials;
}

/** Encrypted credentials */
export interface TelegramEncryptedCredentials {
  data: string;
  hash: string;
  secret: string;
}

/** Proximity alert triggered */
export interface TelegramProximityAlertTriggered {
  traveler: TelegramUser;
  watcher: TelegramUser;
  distance: number;
}

/** Forum topic created */
export interface TelegramForumTopicCreated {
  name: string;
  iconColor: number;
  iconCustomEmojiId?: string;
}

/** Forum topic edited */
export interface TelegramForumTopicEdited {
  name?: string;
  iconCustomEmojiId?: string;
}

/** Forum topic closed */
export interface TelegramForumTopicClosed {
  // No additional fields
}

/** Forum topic reopened */
export interface TelegramForumTopicReopened {
  // No additional fields
}

/** Video chat scheduled */
export interface TelegramVideoChatScheduled {
  startDate: number;
}

/** Video chat started */
export interface TelegramVideoChatStarted {
  // No additional fields
}

/** Video chat ended */
export interface TelegramVideoChatEnded {
  duration: number;
}

/** Video chat participants invited */
export interface TelegramVideoChatParticipantsInvited {
  users: TelegramUser[];
}

/** WebApp data */
export interface TelegramWebAppData {
  data: string;
  buttonText: string;
}

/** Shipping query */
export interface TelegramShippingQuery {
  id: string;
  from: TelegramUser;
  invoicePayload: string;
  shippingAddress: TelegramShippingAddress;
}

/** Shipping address */
export interface TelegramShippingAddress {
  countryCode: string;
  state: string;
  city: string;
  streetLine1: string;
  streetLine2: string;
  postCode: string;
}

/** Pre checkout query */
export interface TelegramPreCheckoutQuery {
  id: string;
  from: TelegramUser;
  currency: string;
  totalAmount: number;
  invoicePayload: string;
  shippingOptionId?: string;
}

/** Poll */
export interface TelegramPoll {
  id: string;
  question: string;
  options: TelegramPollOption[];
  totalVoterCount: number;
  isClosed: boolean;
  isAnonymous: boolean;
  type: 'regular' | 'quiz';
  allowsMultipleAnswers: boolean;
  correctOptionId?: number;
  explanation?: string;
  explanationEntities?: TelegramMessageEntity[];
  openPeriod?: number;
  closeDate?: number;
}

/** Poll option */
export interface TelegramPollOption {
  text: string;
  voterCount: number;
}

/** Poll answer */
export interface TelegramPollAnswer {
  pollId: string;
  user: TelegramUser;
  optionIds: number[];
}

/** Chat member updated */
export interface TelegramChatMemberUpdated {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  oldChatMember: TelegramChatMember;
  newChatMember: TelegramChatMember;
  inviteLink?: TelegramChatInviteLink;
}

/** Chat member */
export interface TelegramChatMember {
  user: TelegramUser;
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  customTitle?: string;
  isAnonymous?: boolean;
  canPostMessages?: boolean;
  canEditMessages?: boolean;
  canDeleteMessages?: boolean;
  canRestrictMembers?: boolean;
  canPromoteMembers?: boolean;
  canChangeInfo?: boolean;
  canInviteUsers?: boolean;
  canPinMessages?: boolean;
  canTopicMessages?: boolean;
  isMember?: boolean;
  canSendMessages?: boolean;
  canSendMediaMessages?: boolean;
  canSendPolls?: boolean;
  canSendOtherMessages?: boolean;
  canAddWebPagePreviews?: boolean;
  untilDate?: number;
}

/** Chat join request */
export interface TelegramChatJoinRequest {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  bio?: string;
  inviteLink?: TelegramChatInviteLink;
}

/** Chat invite link */
export interface TelegramChatInviteLink {
  inviteLink: string;
  creator: TelegramUser;
  createsJoinRequest: boolean;
  isPrimary: boolean;
  isRevoked: boolean;
  name?: string;
  expireDate?: number;
  memberLimit?: number;
  pendingMemberCount?: number;
  quotedMessageDate?: number;
  quotedMessageId?: number;
}

// ============= API Request/Response Types =============

/** getMe response */
export interface TelegramGetMeResponse {
  ok: boolean;
  result: TelegramBotInfo;
}

/** sendMessage options */
export interface TelegramSendMessageParams {
  chatId: number | string;
  text: string;
  parseMode?: 'MarkdownV2' | 'HTML';
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
  replyToMessageId?: number;
  allowSendingWithoutReply?: boolean;
  replyMarkup?: TelegramReplyMarkup;
}

/** Reply markup options */
export type TelegramReplyMarkup =
  | TelegramInlineKeyboardMarkup
  | TelegramReplyKeyboardMarkup
  | TelegramReplyKeyboardRemove
  | TelegramForceReply;

/** Inline keyboard markup */
export interface TelegramInlineKeyboardMarkup {
  inlineKeyboard: TelegramInlineKeyboardButton[][];
}

/** Inline keyboard button */
export interface TelegramInlineKeyboardButton {
  text: string;
  url?: string;
  loginUrl?: TelegramLoginUrl;
  callbackData?: string;
  webApp?: TelegramWebAppInfo;
  switchInlineQuery?: string;
  switchInlineQueryCurrentChat?: string;
  callbackGame?: TelegramCallbackGame;
  pay?: boolean;
}

/** Login URL */
export interface TelegramLoginUrl {
  url: string;
  forwardText?: string;
  botUsername?: string;
}

/** WebApp info */
export interface TelegramWebAppInfo {
  url: string;
}

/** Callback game */
export interface TelegramCallbackGame {
  // No fields, just a marker
}

/** Reply keyboard markup */
export interface TelegramReplyKeyboardMarkup {
  keyboard: TelegramKeyboardButton[][];
  isPersistent?: boolean;
  resizeKeyboard?: boolean;
  oneTimeKeyboard?: boolean;
  inputFieldPlaceholder?: string;
  selective?: boolean;
}

/** Keyboard button */
export interface TelegramKeyboardButton {
  text: string;
  requestUser?: TelegramKeyboardButtonRequestUser;
  requestChat?: TelegramKeyboardButtonRequestChat;
  requestContact?: boolean;
  requestLocation?: boolean;
  requestPoll?: TelegramKeyboardButtonPollType;
  webApp?: TelegramWebAppInfo;
}

/** Keyboard button request user */
export interface TelegramKeyboardButtonRequestUser {
  requestId: number;
  userIsBot?: boolean;
  userIsPremium?: boolean;
}

/** Keyboard button request chat */
export interface TelegramKeyboardButtonRequestChat {
  requestId: number;
  chatIsChannel: boolean;
  chatIsForum?: boolean;
  chatHasUsername?: boolean;
  chatIsCreated?: boolean;
  userAdministratorTitle?: string;
}

/** Keyboard button poll type */
export interface TelegramKeyboardButtonPollType {
  type?: 'regular' | 'quiz';
}

/** Reply keyboard remove */
export interface TelegramReplyKeyboardRemove {
  removeKeyboard: true;
  selective?: boolean;
}

/** Force reply */
export interface TelegramForceReply {
  forceReply: true;
  inputFieldPlaceholder?: string;
  selective?: boolean;
}

// ============= Store State Types =============

/** Telegram store state */
export interface TelegramState {
  // Connection state
  status: TelegramConnectionStatus;
  error?: string;
  botInfo?: TelegramBotInfo;
  token?: string;

  // Messages
  messages: TelegramMessage[];
  lastUpdateId: number;

  // Actions
  connect: (token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  sendMessage: (chatId: number, text: string, options?: Partial<TelegramSendMessageParams>) => Promise<TelegramMessage>;
  clearMessages: () => void;
  setStatus: (status: TelegramConnectionStatus, error?: string) => void;
  addMessage: (message: TelegramMessage) => void;
  updateLastUpdateId: (updateId: number) => void;
}

// ============= Event Types =============

/** Events emitted from backend to frontend */
export type TelegramEvent =
  | { type: 'message'; data: TelegramMessage }
  | { type: 'edited_message'; data: TelegramMessage }
  | { type: 'channel_post'; data: TelegramMessage }
  | { type: 'edited_channel_post'; data: TelegramMessage }
  | { type: 'callback_query'; data: TelegramCallbackQuery }
  | { type: 'error'; error: string }
  | { type: 'status'; status: TelegramConnectionStatus };

// ============= Configuration =============

/** Telegram connector configuration */
export interface TelegramConfig {
  commandPrefix: string;
  allowedChats: '*' | number[];
  groupPolicy: 'open' | 'mention' | 'admin';
  dmPolicy: 'open' | 'whitelist';
  typingIndicator: boolean;
}

/** Default configuration */
export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  commandPrefix: '/',
  allowedChats: '*',
  groupPolicy: 'mention',
  dmPolicy: 'open',
  typingIndicator: true,
};

// ============= Utility Types =============

/** Check if message is a command */
export function isCommandMessage(message: TelegramMessage): boolean {
  if (!message.entities || message.entities.length === 0) {
    return message.text?.startsWith('/') ?? false;
  }
  return message.entities.some(
    (entity) => entity.type === 'bot_command' && entity.offset === 0
  );
}

/** Extract command from message */
export function extractCommand(message: TelegramMessage): { command: string; args: string } | null {
  if (!message.text && !message.entities) return null;

  const text = message.text ?? '';
  const entities = message.entities ?? [];

  const commandEntity = entities.find(
    (e) => e.type === 'bot_command' && e.offset === 0
  );

  if (commandEntity) {
    const command = text.substring(0, commandEntity.length);
    const args = text.substring(commandEntity.length).trim();
    return { command, args };
  }

  // Fallback: check for / prefix
  if (text.startsWith('/')) {
    const spaceIndex = text.indexOf(' ');
    if (spaceIndex === -1) {
      return { command: text, args: '' };
    }
    return {
      command: text.substring(0, spaceIndex),
      args: text.substring(spaceIndex + 1).trim(),
    };
  }

  return null;
}

/** Check if chat is allowed */
export function isChatAllowed(chatId: number, config: TelegramConfig): boolean {
  if (config.allowedChats === '*') return true;
  return config.allowedChats.includes(chatId);
}

/** Format chat name for display */
export function formatChatName(chat: TelegramChat): string {
  if (chat.type === 'private') {
    return chat.firstName ?? 'Unknown';
  }
  return chat.title ?? chat.username ?? 'Unknown Chat';
}

/** Format message date */
export function formatMessageDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}
