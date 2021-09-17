import IntlMessageFormat from 'intl-messageformat'
import DEFAULT_MESSAGES from '../../../_locales/en/messages.json'

interface TranslationEntry {
  message: string;
}
interface Messages {
  [key: string]: TranslationEntry;
}

export default class I18n {
  private locale: string;
  private messages: Messages | undefined;
  private defaultMessages: Messages;
  constructor(locale: string) {
    this.locale = locale
    this.defaultMessages = DEFAULT_MESSAGES
  }

  async load():Promise<void> {
    console.log(this.locale)
    const locale = this.locale
    try {
      this.messages = (await import(`../../../dist/_locales/${locale}.json`)).default
    } catch (error) {
      console.warn(error)
      console.warn(`WARN: Could not find locale '${this.locale}'. Using default locale 'en'`)
    }
  }

  /**
   * Get a formatted message with the given name
   */
  public getMessage(messageName: string, content?: any, formats?: any): string {
    const string = this.doGetMessage(messageName)
    if (string) {
      const message = new IntlMessageFormat(string.message, this.locale, formats).format(content)
      if (!message) {
        return messageName
      }
      if (Array.isArray(message)) {
        return message.join('')
      }
      return message
    }
    return messageName
  }

  /**
   * Get message with given name from the default locale
   */
  private getDefaultLocaleMessage(messageName: string): TranslationEntry | null {
    if (!Object.hasOwnProperty.call(this.defaultMessages, messageName)) {
      console.warn(`WARN: No message found with name ${messageName} in default locale en`)
      return null
    }
    return this.defaultMessages[messageName]
  }

  /**
   * Get message with given name
   */
  private doGetMessage(messageName: string): TranslationEntry | null {
    if (!this.messages || !Object.hasOwnProperty.call(this.messages, messageName)) {
      console.warn(`No message found with name ${messageName} in locale ${this.locale}. Using default locale 'en'`)
      return this.getDefaultLocaleMessage(messageName)
    }
    return this.messages[messageName]
  }
}

export const i18n = new I18n('en')
