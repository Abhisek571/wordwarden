"""Runs Wordwarden's checking engine (engine/engine-host.cjs, with the bundled Node) and talks to it over stdio.
Plain Python, no LibreOffice imports."""

import json
import os
import platform
import queue
import stat
import subprocess
import sys
import threading

# The Philippines and Liberia follow American spelling, New Zealand is closest to Australia.
DIALECTS = {'US': 'american', 'PH': 'american', 'LR': 'american', 'GB': 'british', 'AU': 'australian',
            'NZ': 'australian', 'CA': 'canadian'}
# The engine knows four kinds of English. Everything else follows British spelling.
DEFAULT_DIALECT = 'british'
TIMEOUT_SECONDS = 20


def dialect_for(country):
    return DIALECTS.get(country.upper(), DEFAULT_DIALECT) if country else 'american'


def node_path(root):
    """Picks the bundled Node for this computer."""
    machine = platform.machine().lower()
    arch = 'aarch64' if machine in ('arm64', 'aarch64') else 'x86_64'
    if sys.platform == 'win32':
        return os.path.join(root, 'bin', 'windows-x86_64', 'node.exe')
    system = 'macos' if sys.platform == 'darwin' else 'linux'
    return os.path.join(root, 'bin', '%s-%s' % (system, arch), 'node')


def utf16_length(text):
    return len(text.encode('utf-16-le')) // 2


class Engine:
    """One engine process. Requests are serialised and answered in order."""

    def __init__(self, root):
        executable = node_path(root)
        if os.name != 'nt' and not os.access(executable, os.X_OK):
            # Extension installs do not always keep the executable bit.
            os.chmod(executable, os.stat(executable).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        engine = os.path.join(root, 'engine')
        self._lock = threading.Lock()
        self._replies = queue.Queue()
        self._next_id = 0
        # NODE_OPTIONS set for other programs could open a debugger port, load code into the engine, or stop it.
        environment = {key: value for key, value in os.environ.items() if key != 'NODE_OPTIONS'}
        self._process = subprocess.Popen(
            [executable, os.path.join(engine, 'engine-host.cjs'), os.path.join(engine, 'data')],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=environment,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        threading.Thread(target=self._read_loop, daemon=True).start()

    def alive(self):
        return self._process.poll() is None

    def close(self):
        if self.alive():
            self._process.kill()

    def check(self, text, dialect):
        """Grammar, punctuation, capitalisation and style issues as
        [(start, length, category, rule, message, suggestions)], in UTF-16 units. Spelling is left to spell()."""
        issues = self._request({'type': 'check', 'dialect': dialect, 'text': text})['issues']
        return [(issue['start'], issue['end'] - issue['start'], issue['category'], issue['rule'], issue['message'],
                 _unique(issue['replacements']))
                for issue in issues if issue['category'] != 'spelling' and issue['end'] > issue['start']]

    def spell(self, words, dialect):
        """[(valid, suggestions)] for each word."""
        results = self._request({'type': 'spell', 'dialect': dialect, 'words': list(words)})['results']
        return [(result['valid'], _unique(result['suggestions'])) for result in results]

    def set_dictionary(self, words):
        self._request({'type': 'dictionary', 'words': list(words)})

    def _request(self, request):
        with self._lock:
            self._next_id += 1
            request['id'] = self._next_id
            self._process.stdin.write((json.dumps(request) + '\n').encode('utf-8'))
            self._process.stdin.flush()
            while True:
                try:
                    reply = self._replies.get(timeout=TIMEOUT_SECONDS)
                except queue.Empty:
                    self.close()
                    raise RuntimeError('the Wordwarden engine did not answer in time')
                if reply is None:
                    raise RuntimeError('the Wordwarden engine stopped')
                if reply.get('id') == request['id']:
                    break
            if 'error' in reply:
                raise RuntimeError(reply['error'])
            return reply

    def _read_loop(self):
        try:
            for line in self._process.stdout:
                try:
                    self._replies.put(json.loads(line.decode('utf-8')))
                except ValueError:
                    pass
        finally:
            self._replies.put(None)


def _unique(items):
    seen = []
    for item in items:
        if item not in seen:
            seen.append(item)
    return seen
