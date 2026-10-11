"""Checks the add-on in a throwaway LibreOffice profile, the way an existing user would get it.

Usage: <python that can import uno> tests/libreoffice/check_addon.py <LibreOffice program folder> <add-on .oxt>
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time

import uno
from com.sun.star.lang import Locale

PROOFREADER = 'org.wordwarden.libreoffice.Proofreader'
SPELLCHECKER = 'org.wordwarden.libreoffice.SpellChecker'
program, addon = sys.argv[1], os.path.abspath(sys.argv[2])
exe = '.exe' if os.name == 'nt' else ''
profile = tempfile.mkdtemp(prefix='wordwarden-lo-')
env_arg = '-env:UserInstallation=' + uno.systemPathToFileUrl(profile)
pipe = 'wordwarden%d' % os.getpid()
US, GB = Locale('en', 'US', ''), Locale('en', 'GB', '')


def fail(message):
    print('FAILED:', message)
    sys.exit(1)


def start_office():
    office = subprocess.Popen([os.path.join(program, 'soffice' + exe), '--headless', '--invisible', '--norestore',
                               '--nologo', env_arg, '--accept=pipe,name=%s;urp;' % pipe])
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    for _ in range(120):
        try:
            return office, resolver.resolve('uno:pipe,name=%s;urp;StarOffice.ComponentContext' % pipe)
        except Exception:
            time.sleep(1)
    office.kill()
    fail('LibreOffice did not start')


def stop_office(office, ctx):
    try:
        ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx).terminate()
    except Exception:
        pass
    try:
        office.wait(timeout=60)
    except subprocess.TimeoutExpired:
        office.kill()


def configured(ctx, service, locale):
    lingu = ctx.ServiceManager.createInstanceWithContext('com.sun.star.linguistic2.LinguServiceManager', ctx)
    return lingu.getConfiguredServices(service, locale)


def settings_node(ctx):
    provider = ctx.ServiceManager.createInstanceWithContext('com.sun.star.configuration.ConfigurationProvider', ctx)
    path = uno.createUnoStruct('com.sun.star.beans.PropertyValue')
    path.Name, path.Value = 'nodepath', '/org.wordwarden.Wordwarden/Settings'
    return provider.createInstanceWithArguments('com.sun.star.configuration.ConfigurationUpdateAccess', (path,))


try:
    # An existing user has LibreOffice's own checkers saved as their choice before installing Wordwarden.
    office, ctx = start_office()
    lingu = ctx.ServiceManager.createInstanceWithContext('com.sun.star.linguistic2.LinguServiceManager', ctx)
    lingu.setConfiguredServices('com.sun.star.linguistic2.Proofreader', US, ('org.libreoffice.comp.pyuno.Lightproof.en',))
    lingu.setConfiguredServices('com.sun.star.linguistic2.SpellChecker', US, ('org.openoffice.lingu.MySpellSpellChecker',))
    stop_office(office, ctx)

    subprocess.run([os.path.join(program, 'unopkg' + exe), 'add', '-f', '-s', addon, env_arg], check=True, timeout=300)
    office, ctx = start_office()
    smgr = ctx.ServiceManager
    for _ in range(30):
        if PROOFREADER in configured(ctx, 'com.sun.star.linguistic2.Proofreader', US):
            break
        time.sleep(1)
    for service, name in (('Proofreader', PROOFREADER), ('SpellChecker', SPELLCHECKER)):
        for locale in (US, GB):
            services = configured(ctx, 'com.sun.star.linguistic2.' + service, locale)
            if name not in services:
                fail('Wordwarden is not the en-%s %s after startup: %s' % (locale.Country, service, services))

    checker = smgr.createInstanceWithContext(PROOFREADER, ctx)
    speller = smgr.createInstanceWithContext(SPELLCHECKER, ctx)
    if checker is None or speller is None or smgr.createInstanceWithContext('org.wordwarden.libreoffice.OptionsHandler', ctx) is None:
        fail('the add-on did not load')

    def errors(text, locale=US, proofreader=None):
        result = (proofreader or checker).doProofreading('doc', text, locale, 0, len(text), ())
        return [(e.nErrorStart, e.nErrorLength, e.aSuggestions) for e in result.aErrors]

    def colors(text, proofreader):
        result = proofreader.doProofreading('doc', text, US, 0, len(text), ())
        return [{p.Name: p.Value for p in e.aProperties}.get('LineColor') for e in result.aErrors]

    started = time.time()
    found = errors('This is a apple.')
    print('This is a apple. ->', found, '(%.2fs, includes starting the engine)' % (time.time() - started))
    if (8, 1, ('an',)) not in found:
        fail('expected "a" -> "an", got %s' % found)
    # The emoji is two UTF-16 units, so "a" starts at 11, not 10.
    if (11, 1, ('an',)) not in errors('\U0001F600 This is a apple.'):
        fail('wrong position after an emoji: %s' % errors('\U0001F600 This is a apple.'))
    paragraph = 'Yesterday I went to the the shop. I should of brought a umbrella. My freind was realy nice.'
    found = errors(paragraph)
    print(paragraph, '->', found)
    if any(paragraph[start:start + length] in ('freind', 'realy') for start, length, _ in found):
        fail('spelling mistakes were reported as grammar')
    if len(found) < 3:
        fail('expected the doubled word, "should of" and "a umbrella": %s' % found)

    # Spelling
    if speller.isValid('teh', US, ()) or not speller.isValid('the', US, ()):
        fail('spell checker gets "teh" or "the" wrong')
    alternatives = speller.spell('freind', US, ())
    if alternatives is None or alternatives.getAlternatives()[0] != 'friend':
        fail('expected "friend" first for "freind": %s' % (alternatives and alternatives.getAlternatives(),))
    print('freind ->', alternatives.getAlternatives())
    if not speller.isValid('colour', GB, ()) or speller.isValid('colour', US, ()):
        fail('British and American spelling are mixed up')

    # A word added to the user's LibreOffice dictionary is known to the engine too.
    dictionaries = smgr.createInstanceWithContext('com.sun.star.linguistic2.DictionaryList', ctx)
    if speller.isValid('Zorbleton', US, ()):
        fail('"Zorbleton" should not be a word yet')
    personal = dictionaries.createDictionary(
        'wordwarden-test.dic', Locale('', '', ''), uno.Enum('com.sun.star.linguistic2.DictionaryType', 'POSITIVE'), '')
    dictionaries.addDictionary(personal)
    personal.setActive(True)
    personal.add('Zorbleton', False, '')
    if not speller.isValid('Zorbleton', US, ()):
        fail('a word added to the LibreOffice dictionary is still marked wrong')

    # Settings: colours and a fixed English variant
    if colors('This is a apple.', checker) != [0xE08A00]:
        fail('wrong standard grammar colour: %s' % colors('This is a apple.', checker))
    node = settings_node(ctx)
    node.setPropertyValue('ColorVision', 'red-green')
    node.setPropertyValue('Dialect', 'British')
    node.commitChanges()
    fresh = smgr.createInstanceWithContext(PROOFREADER, ctx)
    if colors('This is a apple.', fresh) != [0xE69F00]:
        fail('red-green palette not applied: %s' % colors('This is a apple.', fresh))
    if not smgr.createInstanceWithContext(SPELLCHECKER, ctx).isValid('colour', US, ()):
        fail('the British setting did not apply to an American paragraph')

    started = time.time()
    errors('I has a apple and he go to school every days, but they was late.')
    print('another paragraph checked in %.2fs' % (time.time() - started))
    print('LibreOffice add-on check passed.')
finally:
    try:
        stop_office(office, ctx)
    except NameError:
        pass
    shutil.rmtree(profile, ignore_errors=True)
