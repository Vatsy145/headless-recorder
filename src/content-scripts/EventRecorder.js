import eventsToRecord from '../code-generator/dom-events-to-record'
import UIController from './UIController'
import actions from '../models/actions'
import finder from '@medv/finder'

export default class EventRecorder {
  constructor () {
    this.eventLog = []
    this.previousEvent = null
    this.dataAttribute = null
    this.uiController = null
    this.screenShotMode = false
    this.isTopFrame = (window.location === window.parent.location)
  }

  boot () {
    // We need to check the existence of chrome for testing purposes
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['options'], ({options}) => {
        const { dataAttribute } = options ? options.code : {}
        if (dataAttribute) {
          this.dataAttribute = dataAttribute
        }
        this._initializeRecorder()
      })
    } else {
      this._initializeRecorder()
    }
  }

  _initializeRecorder () {
    const events = Object.values(eventsToRecord)
    if (!window.pptRecorderAddedControlListeners) {
      this.addAllListeners(events)
      window.pptRecorderAddedControlListeners = true
    }

    if (!window.document.pptRecorderAddedControlListeners && chrome.runtime && chrome.runtime.onMessage) {
      window.document.pptRecorderAddedControlListeners = true
    }

    if (this.isTopFrame) {
      this.sendMessage({ control: 'event-recorder-started' })
      this.sendMessage({ control: 'get-current-url', href: window.location.href })
      this.sendMessage({ control: 'get-viewport-size', coordinates: { width: window.innerWidth, height: window.innerHeight } })
      console.debug('Puppeteer Recorder in-page EventRecorder started')
    }

    this.uiController = new UIController()

    // add listener for actions like recording a screen shot and other right clicky things
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      console.debug('content-script: message from background', msg)
      if (msg && msg.action) {
        switch (msg.action) {
          case actions.toggleScreenshotMode:
            this.handleScreenshotMode(msg, sender, sendResponse)
            break
          default:
        }
      }
    })
  }

  addAllListeners (events) {
    const boundedRecordEvent = this.recordEvent.bind(this)
    events.forEach(type => {
      window.addEventListener(type, boundedRecordEvent, true)
    })
  }

  sendMessage (msg) {
    try {
      // poor man's way of detecting whether this script was injected by an actual extension, or is loaded for
      // testing purposes
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.sendMessage(msg)
      } else {
        this.eventLog.push(msg)
      }
    } catch (err) {
      console.debug('caught error', err)
    }
  }

  recordEvent (e) {
    if (this.previousEvent && this.previousEvent.timeStamp === e.timeStamp) return
    this.previousEvent = e

    // we explicitly catch any errors and swallow them, as none node-type events are also ingested.
    // for these events we cannot generate selectors, which is OK
    try {
      const optimizedMinLength = (e.target.id) ? 2 : 10 // if the target has an id, use that instead of multiple other selectors
      const selector = this.dataAttribute && e.target.hasAttribute && e.target.hasAttribute(this.dataAttribute)
        ? EventRecorder._formatDataSelector(e.target, this.dataAttribute)
        : finder(e.target, {seedMinLength: 5, optimizedMinLength: optimizedMinLength})

      const msg = {
        selector: selector,
        value: e.target.value,
        tagName: e.target.tagName,
        action: e.type,
        keyCode: e.keyCode ? e.keyCode : null,
        href: e.target.href ? e.target.href : null,
        coordinates: EventRecorder._getCoordinates(e)
      }
      this.sendMessage(msg)
    } catch (e) {}
  }

  getEventLog () {
    return this.eventLog
  }

  clearEventLog () {
    this.eventLog = []
  }

  handleScreenshotMode (msg, sender, sendResponse) {
    this.screenShotMode = !this.screenShotMode
    console.debug('screenshot mode:', this.screenShotMode)
    if (this.screenShotMode) {
      this.uiController.showScreenshotSelector()
    } else {
      this.uiController.hideScreenshotSelector()
    }
  }

  static _getCoordinates (evt) {
    const eventsWithCoordinates = {
      mouseup: true,
      mousedown: true,
      mousemove: true,
      mouseover: true
    }
    return eventsWithCoordinates[evt.type] ? { x: evt.clientX, y: evt.clientY } : null
  }
  static _formatDataSelector (element, attribute) {
    return `[${attribute}="${element.getAttribute(attribute)}"]`
  }
}