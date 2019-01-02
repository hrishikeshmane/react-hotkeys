import KeyEventBitmapManager from '../KeyEventBitmapManager';
import KeyEventBitmapIndex from '../../const/KeyEventBitmapIndex';
import KeyEventSequenceIndex from '../../const/KeyEventSequenceIndex';
import AbstractKeyEventStrategy from './AbstractKeyEventStrategy';
import capitalize from '../../utils/string/capitalize';
import normalizeKeyName from '../../helpers/resolving-handlers/normalizeKeyName';
import hasKeyPressEvent from '../../helpers/resolving-handlers/hasKeyPressEvent';
import describeKeyEvent from '../../helpers/logging/describeKeyEvent';
import KeyEventCounter from '../KeyEventCounter';
import Logger from '../Logger';
import removeAtIndex from '../../utils/array/removeAtIndex';
import isUndefined from '../../utils/isUndefined';
import getEventKey from '../../vendor/react-dom/getEventKey';

class GlobalKeyEventStrategy extends AbstractKeyEventStrategy {
  /********************************************************************************
   * Init & Reset
   ********************************************************************************/

  /**
   * Creates a new KeyEventManager instance. It is expected that only a single instance
   * will be used with a render tree.
   */
  constructor(configuration = {}, keyEventManager) {
    /**
     * Set state that does get cleared every time a component gets mounted or unmounted
     */
    super(configuration);

    /**
     * Set state that doesn't get cleared each time a new new component is mounted
     * or unmounted
     * @type {number}
     */

    this.componentIndex = -1;
    this.keyEventManager = keyEventManager;
    this.eventOptions = {};
  }

  _reset() {
    super._reset();

    /**
     * State that is specific to global key event strategy
     */
    this.handlerCounts = {
      [KeyEventBitmapIndex.keydown]: 0,
      [KeyEventBitmapIndex.keypress]: 0,
      [KeyEventBitmapIndex.keyup]: 0
    };

    this.componentIndexDict = {};
  }

  /********************************************************************************
   * Registering key maps and handlers
   ********************************************************************************/

  addHotKeys(actionNameToKeyMap = {}, actionNameToHandlersMap = {}, options, eventOptions) {
    this.eventOptions = eventOptions;

    this.componentIndex += 1;

    this._addComponentToList(
      this.componentIndex,
      actionNameToKeyMap,
      actionNameToHandlersMap,
      options
    );

    this._updateDocumentHandlers();

    this.logger.debug(
      this._logPrefix(this.componentIndex, {eventId: false}),
      `Mounted.`,
    );

    this.logger.verbose(
      this._logPrefix(this.componentIndex, {eventId: false}),
      'Component options: \n',
      this._printComponent(this._getComponent(this.componentIndex))
    );

    return this.componentIndex;
  }

  _addComponentToList(componentIndex, actionNameToKeyMap = {}, actionNameToHandlersMap = {}, options) {
    super._addComponentToList(
      componentIndex,
      actionNameToKeyMap,
      actionNameToHandlersMap,
      options
    );

    this._setComponentPosition(componentIndex, this.componentList.length - 1);
  }

  _setComponentPosition(componentIndex, position) {
    this.componentIndexDict[componentIndex] = position;
  }

  updateHotKeys(componentIndex, actionNameToKeyMap = {}, actionNameToHandlersMap = {}, options, eventOptions) {
    this.eventOptions = eventOptions;

    const componentPosition = this._getComponentPosition(componentIndex);

    /**
     * Manually update the registered key map state, usually reset using
     * _resetRegisteredKeyMapsState() method
     */

    this.componentList[componentPosition] = this._buildComponentOptions(
      componentIndex,
      actionNameToKeyMap,
      actionNameToHandlersMap,
      options
    );

    this._updateLongestKeySequenceIfNecessary(componentIndex);

    /**
     * Reset strategy state specific to the global strategy
     */

    this._updateDocumentHandlers();

    /**
     * Reset handler resolution state
     */
    this._resetHandlerResolutionState();

    this.logger.debug(
      this._logPrefix(this.componentIndex, {eventId: false}),
      `Global component ${componentIndex} updated.`,
    );

    this.logger.verbose(
      this._logPrefix(this.componentIndex, {eventId: false}),
      'Component options: \n',
      this._printComponent(this._getComponent(componentIndex))
    );
  }

  removeHotKeys(componentIndex) {
    const [{ keyMapEventBitmap }, componentPosition ] =
      this._getComponentAndPosition(componentIndex);

    /**
     * Manually update the registered key map state, usually reset using
     * _resetRegisteredKeyMapsState() method
     */
    this.componentList = removeAtIndex(this.componentList, componentPosition);

    this._updateLongestKeySequenceIfNecessary(componentIndex);

    /**
     * Reset strategy state specific to the global strategy
     */
    this._updateComponentIndexDictFromList({ startingAt: componentPosition });

    this._updateDocumentHandlers(
      keyMapEventBitmap,
      KeyEventBitmapManager.newBitmap()
    );

    /**
     * Reset handler resolution state
     */
    this._resetHandlerResolutionState();

    this.logger.debug(
      this._logPrefix(this.componentIndex, {eventId: false}),
      `Unmounted global component ${componentIndex}`
    );
  }

  _updateLongestKeySequenceIfNecessary(componentIndex) {
    if (componentIndex === this.longestSequenceComponentIndex) {
      this.longestSequence = 1;

      this.componentList.forEach(({longestSequence}) => {
        if(longestSequence > this.longestSequence) {
          this.longestSequence = longestSequence;
        }
      });
    }
  }

  _updateComponentIndexDictFromList(options = { startingAt: 0 }) {
    let counter = options.startAt;

    while(counter < this.componentList.length) {
      this._setComponentPosition(this.componentList[counter].componentIndex, counter);
    }
  }

  _updateDocumentHandlers(){
    if (this.keyMapEventBitmap.some((eventType) => eventType)) {
      for(let bitmapIndex = 0; bitmapIndex < this.keyMapEventBitmap.length; bitmapIndex++) {
        const eventName = describeKeyEvent(bitmapIndex);

        document[`on${eventName}`] = (keyEvent) => {
          this.keyEventManager[`handleGlobal${capitalize(eventName)}`](keyEvent);
        };

        this.logger.debug(
          this._logPrefix(this.componentIndex, {eventId: false}),
          `Bound handler handleGlobal${capitalize(eventName)}() to document.on${eventName}()`
        );
      }

    } else {

      for(let bitmapIndex = 0; bitmapIndex < this.keyMapEventBitmap.length; bitmapIndex++) {
        const eventName = describeKeyEvent(bitmapIndex);

        delete document[`on${eventName}`];

        this.logger.debug(
          this._logPrefix(this.componentIndex, {eventId: false}),
          `Removed handler handleGlobal${capitalize(eventName)}() from document.on${eventName}()`
        );
      }
    }
  }

  /********************************************************************************
   * Recording key events
   ********************************************************************************/

  handleKeydown(event) {
    const _key = normalizeKeyName(getEventKey(event));

    const reactAppHistoryWithEvent =
      this.keyEventManager.reactAppHistoryWithEvent(_key, KeyEventBitmapIndex.keydown);

    if (reactAppHistoryWithEvent === 'handled') {
      this.logger.debug(
        `${this._logPrefix()} Ignored '${_key}' keydown event because React app has already handled it.`
      );

      return false;
    } else {
      if (reactAppHistoryWithEvent === 'seen') {
        this.logger.debug(
          `${this._logPrefix()} '${_key}' keydown event (that has already passed through React app).`
        );

      } else {
        KeyEventCounter.incrementId();

        this.logger.debug(
          `${this._logPrefix()} New '${_key}' keydown event (that has NOT passed through React app).`
        );
      }

      if (this.eventOptions.ignoreEventsCondition(event)) {
        this.logger.debug(
          `${this._logPrefix()} Ignored '${_key}' keydown event because ignoreEventsFilter rejected it.`
        );

        return false;
      }

      const keyInCurrentCombination = !!this._getCurrentKeyCombination().keys[_key];

      if (keyInCurrentCombination || this.keyCombinationIncludesKeyUp) {
        this._startNewKeyCombination(_key, KeyEventBitmapIndex.keydown);

        this.logger.verbose(
          `${this._logPrefix()} Started a new combination with '${_key}'.`
        );
      } else {
        this._addToCurrentKeyCombination(_key, KeyEventBitmapIndex.keydown);

        this.logger.verbose(
          `${this._logPrefix()} Added '${_key}' to current combination: ${this._getCurrentKeyCombination().ids[0]}.`
        );
      }

      this._callHandlerIfExists(event, _key, KeyEventBitmapIndex.keydown);

      if (!hasKeyPressEvent(_key)) {
        this.logger.debug(
          `${this._logPrefix()} Simulating '${_key}' keypress event because '${_key}' doesn't natively have one.`
        );

        /**
         * If a key does not have a keypress event, we simulate one immediately after
         * the keydown event, to keep the behaviour consistent across all keys
         */
        this.handleKeypress(event);
      }

      return false;
    }
  }

  handleKeypress(event) {
    const _key = normalizeKeyName(getEventKey(event));

    const reactAppHistoryWithEvent =
      this.keyEventManager.reactAppHistoryWithEvent(_key, KeyEventBitmapIndex.keypress);

    if (reactAppHistoryWithEvent === 'handled') {
      this.logger.debug(
        `${this._logPrefix()} Ignored '${_key}' keypress event because React app has already handled it.`
      );

      return false;
    } else {
      if (reactAppHistoryWithEvent === 'seen') {
        this.logger.debug(
          `${this._logPrefix()} '${_key}' keypress event (that has already passed through React app).`
        );

      } else {
        KeyEventCounter.incrementId();

        this.logger.debug(
          `${this._logPrefix()} New '${_key}' keypress event (that has NOT passed through React app).`
        );
      }

      if (this.eventOptions.ignoreEventsCondition(event)) {
        this.logger.debug(
          `${this._logPrefix()} Ignored '${_key}' keypress event because ignoreEventsFilter rejected it.`
        );

        return false;
      }

      /**
       * Add new key event to key combination history
       */

      const keyCombination = this._getCurrentKeyCombination().keys[_key];

      const alreadySeenKeyInCurrentCombo =
        keyCombination && (keyCombination[KeyEventSequenceIndex.current][KeyEventBitmapIndex.keypress] || keyCombination[KeyEventSequenceIndex.current][KeyEventBitmapIndex.keyup]);

      if (alreadySeenKeyInCurrentCombo) {
        this._startNewKeyCombination(_key, KeyEventBitmapIndex.keypress);

        this.logger.verbose(
          `${this._logPrefix()} Started a new combination with '${_key}'.`
        );
      } else {
        this._addToCurrentKeyCombination(_key, KeyEventBitmapIndex.keypress);
      }

      this._callHandlerIfExists(event, _key, KeyEventBitmapIndex.keypress);
    }
  }

  handleKeyup(event) {
    const _key = normalizeKeyName(getEventKey(event));

    const reactAppHistoryWithEvent =
      this.keyEventManager.reactAppHistoryWithEvent(_key, KeyEventBitmapIndex.keyup);

    if (reactAppHistoryWithEvent === 'handled') {
      this.logger.debug(
        `${this._logPrefix()} Ignored '${_key}' keyup event because React app has already handled it.`
      );

      return false;
    } else {
      if (reactAppHistoryWithEvent === 'seen') {
        this.logger.debug(
          `${this._logPrefix()} '${_key}' keyup event (that has already passed through React app).`
        );

      } else {
        KeyEventCounter.incrementId();

        this.logger.debug(
          `${this._logPrefix()} New '${_key}' keyup event (that has NOT passed through React app).`
        );
      }

      if (this.eventOptions.ignoreEventsCondition(event)) {
        this.logger.debug(
          `${this._logPrefix()} Ignored '${_key}' keyup event because ignoreEventsFilter rejected it.`
        );

        return false;
      }

      const keyCombination = this._getCurrentKeyCombination().keys[_key];

      const alreadySeenKeyInCurrentCombo = keyCombination && keyCombination[KeyEventSequenceIndex.current][KeyEventBitmapIndex.keyup];

      if (alreadySeenKeyInCurrentCombo) {
        this.logger.verbose(
          `${this._logPrefix()} Started a new combination with '${_key}'.`
        );

        this._startNewKeyCombination(_key, KeyEventBitmapIndex.keyup);
      } else {
        this._addToCurrentKeyCombination(_key, KeyEventBitmapIndex.keyup);

        this.logger.verbose(
          `${this._logPrefix()} Added '${_key}' to current combination: '${this._describeCurrentKeyCombination()}'.`
        );

        this.keyCombinationIncludesKeyUp = true;
      }

      this._callHandlerIfExists(event, _key, KeyEventBitmapIndex.keyup);
    }
  }

  _getComponentPosition(componentIndex){
    return this.componentIndexDict[componentIndex];
  }

  _getComponent(componentIndex){
    const componentPosition = this._getComponentPosition(componentIndex);
    return this.componentList[componentPosition];
  }

  _getComponentAndPosition(componentIndex){
    const componentPosition = this._getComponentPosition(componentIndex);
    return [ this.componentList[componentPosition], componentPosition ];
  }

  /********************************************************************************
   * Matching and calling handlers
   ********************************************************************************/

  _callHandlerIfExists(event, keyName, eventBitmapIndex) {
    const eventName = describeKeyEvent(eventBitmapIndex);
    const combinationName = this._describeCurrentKeyCombination();

    if (this.keyMapEventBitmap[eventBitmapIndex]) {
      /**
       * If there is at least one handler for the specified key event type (keydown,
       * keypress, keyup), then attempt to find a handler that matches the current
       * key combination
       */
      this.logger.verbose(
        `${this._logPrefix()} Attempting to find action matching '${combinationName}' ${eventName} . . .`
      );

      this._callMatchingHandlerClosestToEventTarget(
        event,
        keyName,
        eventBitmapIndex
      );
    } else {
      /**
       * If there are no handlers registered for the particular key event type
       * (keydown, keypress, keyup) then skip trying to find a matching handler
       * for the current key combination
       */
      this.logger.debug(
        `${this._logPrefix()} Ignored '${combinationName}' ${eventName} because it doesn't have any ${eventName} handlers.`
      );
    }
  }

  _callMatchingHandlerClosestToEventTarget(event, keyName, eventBitmapIndex) {
    for(let componentIndex = 0; componentIndex < this.componentList.length; componentIndex++) {
      const matchFound = super._callMatchingHandlerClosestToEventTarget(
        event,
        keyName,
        eventBitmapIndex,
        componentIndex
      );

      if (matchFound) {
        this.logger.debug(
          `${this._logPrefix()} Searching no further, as handler has been found (and called).`
        );

        return;
      }
    }
  }

  /********************************************************************************
   * Logging
   ********************************************************************************/

  _logPrefix(componentIndex, options = {}) {
    const eventIcons = Logger.eventIcons;
    const componentIcons = Logger.componentIcons;

    let base = `HotKeys (GLOBAL`;

    if (options.eventId !== false) {
      base = `${base}-E${KeyEventCounter.getId()}${eventIcons[KeyEventCounter.getId() % eventIcons.length]}`
    }

    if (isUndefined(componentIndex)) {
      return `${base}):`
    } else {
      return `${base}-C${componentIndex}${componentIcons[componentIndex % componentIcons.length]}):`;
    }
  }
}


export default GlobalKeyEventStrategy;
