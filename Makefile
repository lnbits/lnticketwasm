.PHONY: check test build package runtime-check
JCO ?= jco
PYTHON ?= ../../../.venv/bin/python
check: test
	node --check static/app.js
	node --check static/bridge.js
	node dev/scripts/check.mjs

test:
	cd dev && npm test

build:
	node dev/scripts/bundle.mjs
	$(JCO) componentize dev/dist/index.js --disable all --enable clocks --enable random --enable stdio --wit wasm/lnbits-extension.wit --world-name extension -o wasm/module.wasm

package:
	$(PYTHON) dev/scripts/package.py

runtime-check:
	$(PYTHON) dev/scripts/runtime_check.py
