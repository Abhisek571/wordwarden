# Wordwarden for LibreOffice: spelling and grammar checking with the browser extension's engine, on this computer.

import os
import threading

import uno
import unohelper
from com.sun.star.awt import XContainerWindowEventHandler
from com.sun.star.lang import Locale, XServiceDisplayName, XServiceInfo, XServiceName
from com.sun.star.linguistic2 import (XDictionaryListEventListener, XLinguServiceEventBroadcaster, XProofreader,
                                      XSpellAlternatives, XSpellChecker, XSupportedLocales)
from com.sun.star.linguistic2.LinguServiceEventFlags import PROOFREAD_AGAIN, SPELL_CORRECT_WORDS_AGAIN, SPELL_WRONG_WORDS_AGAIN
from com.sun.star.linguistic2.SpellFailure import SPELLING_ERROR
from com.sun.star.task import XJob
from com.sun.star.text.TextMarkupType import PROOFREADING

import wordwarden_engine

PROOFREADER_NAME = 'org.wordwarden.libreoffice.Proofreader'
SPELLCHECKER_NAME = 'org.wordwarden.libreoffice.SpellChecker'
OPTIONS_HANDLER_NAME = 'org.wordwarden.libreoffice.OptionsHandler'
SETUP_JOB_NAME = 'org.wordwarden.libreoffice.SetupJob'
PROOFREADER_SERVICE = 'com.sun.star.linguistic2.Proofreader'
SPELLCHECKER_SERVICE = 'com.sun.star.linguistic2.SpellChecker'
SETTINGS_PATH = '/org.wordwarden.Wordwarden/Settings'
COUNTRIES = ('US', 'GB', 'AU', 'CA', 'NZ', 'IE', 'ZA', 'IN', 'PH', 'NA', 'ZW', 'BZ', 'BS', 'GH', 'JM', 'TT', 'IL')
EXTENSION_ROOT = os.path.dirname(os.path.abspath(__file__))
# A checker that keeps failing is not retried on every keystroke.
MAX_FAILURES = 3
SPELL_CACHE_LIMIT = 50000

# The browser extension's palettes. Colour-blind ones keep grammar and style apart without relying on red-green
# or blue-yellow differences.
PALETTES = {
    'standard': {'grammar': '#e08a00', 'style': '#1e6fd9'},
    'red-green': {'grammar': '#e69f00', 'style': '#b8458f'},
    'blue-yellow': {'grammar': '#00838f', 'style': '#5f6b7a'},
}
COLOR_VISIONS = ('standard', 'red-green', 'blue-yellow', 'custom')
LINE_STYLES = {'wave': 'WAVE', 'thin': 'SMALLWAVE', 'thick': 'BOLDWAVE'}
LINE_STYLE_ORDER = ('wave', 'thin', 'thick')
DIALECT_ORDER = ('document', 'American', 'British', 'Australian', 'Canadian')
DEFAULT_SETTINGS = {'Dialect': 'document', 'ColorVision': 'standard', 'GrammarColor': '#e08a00',
                    'StyleColor': '#1e6fd9', 'LineStyle': 'wave', 'StyleSuggestions': True}

settings = dict(DEFAULT_SETTINGS)
# Every checker LibreOffice creates, so the options page can ask all of them to check again.
checkers = []


def _settings_node(ctx, update=False):
    provider = ctx.ServiceManager.createInstanceWithContext('com.sun.star.configuration.ConfigurationProvider', ctx)
    service = 'com.sun.star.configuration.ConfigurationUpdateAccess' if update else 'com.sun.star.configuration.ConfigurationAccess'
    return provider.createInstanceWithArguments(service, (_property('nodepath', SETTINGS_PATH),))


def load_settings(ctx):
    try:
        node = _settings_node(ctx)
        for name in DEFAULT_SETTINGS:
            settings[name] = node.getPropertyValue(name)
    except Exception:
        settings.update(DEFAULT_SETTINGS)


def _property(name, value):
    prop = uno.createUnoStruct('com.sun.star.beans.PropertyValue')
    prop.Name = name
    prop.Value = value
    return prop


def _color(value, fallback):
    value = (value or '').strip().lstrip('#')
    try:
        return int(value, 16) if len(value) == 6 else int(fallback.lstrip('#'), 16)
    except ValueError:
        return int(fallback.lstrip('#'), 16)


def underline(category):
    """(colour as 0xRRGGBB, FontUnderline value) for 'grammar' or 'style'."""
    vision = settings['ColorVision']
    if vision == 'custom':
        key = 'GrammarColor' if category == 'grammar' else 'StyleColor'
        color = _color(settings[key], PALETTES['standard'][category])
    else:
        color = _color(PALETTES.get(vision, PALETTES['standard'])[category], PALETTES['standard'][category])
    line = LINE_STYLES.get(settings['LineStyle'], 'WAVE')
    return color, uno.getConstantByName('com.sun.star.awt.FontUnderline.' + line)


def dialect(locale):
    chosen = settings['Dialect']
    if chosen in DIALECT_ORDER[1:]:
        return chosen.lower()
    return wordwarden_engine.dialect_for(locale.Country)


class Shared:
    """One engine process for every checker, with the user's LibreOffice dictionaries loaded into it."""

    def __init__(self):
        self.lock = threading.Lock()
        self.engine = None
        self.failures = 0
        self.ctx = None
        self.dictionary_listener = None
        self.dictionary_changed = True
        self.spellings = {}

    def get(self, ctx):
        with self.lock:
            self.ctx = self.ctx or ctx
            if self.failures >= MAX_FAILURES:
                raise RuntimeError('the Wordwarden engine keeps failing')
            if self.engine is None or not self.engine.alive():
                self.engine = wordwarden_engine.Engine(EXTENSION_ROOT)
                self.dictionary_changed = True
            if self.dictionary_changed:
                self.dictionary_changed = False
                self.spellings.clear()
                self.engine.set_dictionary(self._dictionary_words())
            return self.engine

    def failed(self):
        self.failures += 1

    def succeeded(self):
        self.failures = 0

    def _dictionary_words(self):
        """Words from the user's active LibreOffice dictionaries, so the engine's spelling fixes know them."""
        try:
            dictionaries = self.ctx.ServiceManager.createInstanceWithContext(
                'com.sun.star.linguistic2.DictionaryList', self.ctx)
            if self.dictionary_listener is None:
                self.dictionary_listener = DictionaryListener(self)
                dictionaries.addDictionaryListEventListener(self.dictionary_listener, True)
            words = []
            for dictionary in dictionaries.getDictionaries():
                # Dictionaries for every language are tagged zxx, such as LibreOffice's technical word list.
                negative = dictionary.getDictionaryType() == uno.Enum('com.sun.star.linguistic2.DictionaryType', 'NEGATIVE')
                if dictionary.isActive() and not negative and dictionary.getLocale().Language in ('en', 'zxx', ''):
                    words.extend(entry.getDictionaryWord() for entry in dictionary.getEntries())
            return words[:10000]
        except Exception:
            return []


class DictionaryListener(unohelper.Base, XDictionaryListEventListener):

    def __init__(self, shared):
        self.shared = shared

    def processDictionaryListEvent(self, event):
        self.shared.dictionary_changed = True

    def disposing(self, source):
        pass


shared = Shared()


class Checker(unohelper.Base, XServiceInfo, XServiceName, XServiceDisplayName, XSupportedLocales,
              XLinguServiceEventBroadcaster):
    """What the spell checker and the grammar checker have in common."""
    implementation = ''
    service = ''

    def __init__(self, ctx, *args):
        self.ctx = ctx
        self.locales = tuple(Locale('en', country, '') for country in COUNTRIES)
        self.listeners = []
        load_settings(ctx)
        checkers.append(self)

    def getImplementationName(self):
        return self.implementation

    def supportsService(self, name):
        return name == self.service

    def getSupportedServiceNames(self):
        return (self.service,)

    def getServiceName(self):
        return self.implementation

    def getServiceDisplayName(self, locale):
        return 'Wordwarden'

    def getLocales(self):
        return self.locales

    def hasLocale(self, locale):
        return locale.Language == 'en'

    # XLinguServiceEventBroadcaster: lets the options page ask LibreOffice to check open documents again.

    def addLinguServiceEventListener(self, listener):
        if listener not in self.listeners:
            self.listeners.append(listener)
        return True

    def removeLinguServiceEventListener(self, listener):
        if listener in self.listeners:
            self.listeners.remove(listener)
        return True

    def check_again(self):
        event = uno.createUnoStruct('com.sun.star.linguistic2.LinguServiceEvent')
        event.Source = self
        event.nEvent = PROOFREAD_AGAIN | SPELL_CORRECT_WORDS_AGAIN | SPELL_WRONG_WORDS_AGAIN
        for listener in list(self.listeners):
            try:
                listener.processLinguServiceEvent(event)
            except Exception:
                self.listeners.remove(listener)


class Proofreader(Checker, XProofreader):
    implementation = PROOFREADER_NAME
    service = PROOFREADER_SERVICE

    def __init__(self, ctx, *args):
        Checker.__init__(self, ctx)
        self.ignored_rules = set()

    def isSpellChecker(self):
        return False

    def ignoreRule(self, rule, locale):
        self.ignored_rules.add(rule)

    def resetIgnoreRules(self):
        self.ignored_rules.clear()

    def doProofreading(self, doc_id, text, locale, start, suggested_end, properties):
        result = uno.createUnoStruct('com.sun.star.linguistic2.ProofreadingResult')
        result.aDocumentIdentifier = doc_id
        result.aText = text
        result.aLocale = locale
        result.nStartOfSentencePosition = start
        result.nStartOfNextSentencePosition = suggested_end
        result.nBehindEndOfSentencePosition = suggested_end
        result.aProperties = ()
        result.xProofreader = self
        result.aErrors = ()
        # The whole paragraph is checked on the first call; later sentences of it have nothing left to report.
        if start != 0:
            return result
        # LibreOffice counts positions in UTF-16 units, as the engine does.
        result.nStartOfNextSentencePosition = wordwarden_engine.utf16_length(text)
        result.nBehindEndOfSentencePosition = result.nStartOfNextSentencePosition
        if text.strip() == '':
            return result
        try:
            issues = shared.get(self.ctx).check(text, dialect(locale))
            shared.succeeded()
        except Exception:
            shared.failed()
            return result
        errors = []
        for issue in issues:
            is_style = issue[2] == 'style'
            if issue[3] in self.ignored_rules or (is_style and not settings['StyleSuggestions']):
                continue
            errors.append(self._error(issue, 'style' if is_style else 'grammar'))
        result.aErrors = tuple(errors)
        return result

    def _error(self, issue, category):
        start, length, _category, rule, message, suggestions = issue
        color, line = underline(category)
        error = uno.createUnoStruct('com.sun.star.linguistic2.SingleProofreadingError')
        error.nErrorStart = start
        error.nErrorLength = length
        error.nErrorType = PROOFREADING
        error.aRuleIdentifier = rule
        error.aShortComment = message
        error.aFullComment = message
        error.aSuggestions = tuple(suggestions)
        error.aProperties = (_property('LineColor', color), _property('LineType', line))
        return error


class SpellAlternatives(unohelper.Base, XSpellAlternatives):

    def __init__(self, word, locale, suggestions):
        self.word = word
        self.locale = locale
        self.suggestions = tuple(suggestions)

    def getWord(self):
        return self.word

    def getLocale(self):
        return self.locale

    def getFailureType(self):
        return SPELLING_ERROR

    def getAlternativesCount(self):
        return len(self.suggestions)

    def getAlternatives(self):
        return self.suggestions


class SpellChecker(Checker, XSpellChecker):
    """Red underlines and their right-click fixes. LibreOffice checks the user's own dictionaries before asking."""
    implementation = SPELLCHECKER_NAME
    service = SPELLCHECKER_SERVICE

    def isValid(self, word, locale, properties):
        return self._lookup(word, locale)[0]

    def spell(self, word, locale, properties):
        valid, suggestions = self._lookup(word, locale)
        return None if valid else SpellAlternatives(word, locale, suggestions)

    def _lookup(self, word, locale):
        if not word or not any(char.isalpha() for char in word):
            return True, []
        key = (dialect(locale), word)
        try:
            # Loads changed dictionaries first, which also empties the cache.
            engine = shared.get(self.ctx)
            cached = shared.spellings.get(key)
            if cached is not None:
                return cached
            answer = engine.spell([word], key[0])[0]
            shared.succeeded()
        except Exception:
            shared.failed()
            # When the engine cannot answer, nothing is marked wrong.
            return True, []
        if len(shared.spellings) > SPELL_CACHE_LIMIT:
            shared.spellings.clear()
        shared.spellings[key] = answer
        return answer


class SetupJob(unohelper.Base, XServiceInfo, XJob):
    """Runs when LibreOffice starts. The first time, makes Wordwarden the English spelling and grammar checker;
    after that the user's own choice in Writing Aids is left alone."""

    def __init__(self, ctx, *args):
        self.ctx = ctx

    def getImplementationName(self):
        return SETUP_JOB_NAME

    def supportsService(self, name):
        return name == 'com.sun.star.task.Job'

    def getSupportedServiceNames(self):
        return ('com.sun.star.task.Job',)

    def execute(self, arguments):
        try:
            node = _settings_node(self.ctx, update=True)
            if node.getPropertyValue('Activated'):
                return None
            lingu = self.ctx.ServiceManager.createInstanceWithContext(
                'com.sun.star.linguistic2.LinguServiceManager', self.ctx)
            for country in COUNTRIES:
                locale = Locale('en', country, '')
                lingu.setConfiguredServices(PROOFREADER_SERVICE, locale, (PROOFREADER_NAME,))
                lingu.setConfiguredServices(SPELLCHECKER_SERVICE, locale, (SPELLCHECKER_NAME,))
            node.setPropertyValue('Activated', True)
            node.commitChanges()
        except Exception:
            pass
        return None


class OptionsHandler(unohelper.Base, XServiceInfo, XContainerWindowEventHandler):
    """Fills and saves the Wordwarden page in Tools > Options and the Extension Manager."""

    def __init__(self, ctx, *args):
        self.ctx = ctx

    def getImplementationName(self):
        return OPTIONS_HANDLER_NAME

    def supportsService(self, name):
        return name == OPTIONS_HANDLER_NAME

    def getSupportedServiceNames(self):
        return (OPTIONS_HANDLER_NAME,)

    def getSupportedMethodNames(self):
        return ('external_event',)

    def callHandlerMethod(self, window, event, method):
        if method != 'external_event':
            return False
        if event == 'ok':
            self._save(window)
        elif event in ('back', 'initialize'):
            self._show(window)
        return True

    def _show(self, window):
        load_settings(self.ctx)
        _select(window, 'Dialect', DIALECT_ORDER, settings['Dialect'])
        _select(window, 'ColorVision', COLOR_VISIONS, settings['ColorVision'])
        window.getControl('GrammarColor').setText(settings['GrammarColor'])
        window.getControl('StyleColor').setText(settings['StyleColor'])
        _select(window, 'LineStyle', LINE_STYLE_ORDER, settings['LineStyle'])
        window.getControl('StyleSuggestions').setState(1 if settings['StyleSuggestions'] else 0)

    def _save(self, window):
        values = {
            'Dialect': _selected(window, 'Dialect', DIALECT_ORDER),
            'ColorVision': _selected(window, 'ColorVision', COLOR_VISIONS),
            'GrammarColor': _clean_color(window.getControl('GrammarColor').getText(), DEFAULT_SETTINGS['GrammarColor']),
            'StyleColor': _clean_color(window.getControl('StyleColor').getText(), DEFAULT_SETTINGS['StyleColor']),
            'LineStyle': _selected(window, 'LineStyle', LINE_STYLE_ORDER),
            'StyleSuggestions': window.getControl('StyleSuggestions').getState() == 1,
        }
        node = _settings_node(self.ctx, update=True)
        for name, value in values.items():
            node.setPropertyValue(name, value)
        node.commitChanges()
        settings.update(values)
        shared.spellings.clear()
        for checker in checkers:
            checker.check_again()


def _select(window, control, choices, value):
    window.getControl(control).selectItemPos(choices.index(value) if value in choices else 0, True)


def _selected(window, control, choices):
    position = window.getControl(control).getSelectedItemPos()
    return choices[position] if 0 <= position < len(choices) else choices[0]


def _clean_color(text, fallback):
    value = text.strip().lstrip('#').lower()
    if len(value) == 6 and all(char in '0123456789abcdef' for char in value):
        return '#' + value
    return fallback


g_ImplementationHelper = unohelper.ImplementationHelper()
g_ImplementationHelper.addImplementation(Proofreader, PROOFREADER_NAME, (PROOFREADER_SERVICE,))
g_ImplementationHelper.addImplementation(SpellChecker, SPELLCHECKER_NAME, (SPELLCHECKER_SERVICE,))
g_ImplementationHelper.addImplementation(SetupJob, SETUP_JOB_NAME, ('com.sun.star.task.Job',))
g_ImplementationHelper.addImplementation(OptionsHandler, OPTIONS_HANDLER_NAME, (OPTIONS_HANDLER_NAME,))
