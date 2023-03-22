import IntlMessageFormat from 'intl-messageformat'
import DEFAULT_MESSAGES from '../../../_locales/en/messages.json'

// hehe, ignore all the things...
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const context = require.context(
  '../../../_locales',
  true,
  /^.*?\.json$/,
  'lazy'
)

interface TranslationEntry {
  message: string;
}
interface Messages {
  [key: string]: TranslationEntry;
}

export default class I18n {
  private locales: string[];
  private locale = 'en'
  private messages: Messages | undefined;
  private defaultMessages: Messages;
  constructor(locale: string) {
    this.locales = [locale]
    this.defaultMessages = DEFAULT_MESSAGES
    this.messages = DEFAULT_MESSAGES
  }

  setLocales(locales:string[]):void {
    this.locales = locales
  }

  async load():Promise<void> {
    for (const locale of this.locales) {
      try {
        const fileName = './' + locale.replace('-', '_') + '/messages.json'
        const imported = await context(fileName)
        console.log(imported)
        this.messages = imported
        this.locale = locale
        break
      } catch (error) {
        console.warn(error)
      }
      try {
        const fileName = './' + locale.split('-')[0] + '/messages.json'
        const imported = await context(fileName)
        console.log(imported)
        this.messages = imported
        this.locale = locale.split('-')[0]
        break
      } catch (error) {
        console.warn(error)
      }
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
