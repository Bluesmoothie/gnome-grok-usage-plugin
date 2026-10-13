UUID := grok-quota@ygille
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: test check install uninstall enable pack install-indicator indicator

test:
	node --test tests/billing.test.js

check: test
	node --check extension.js
	node --check prefs.js
	node --check lib/auth.js
	node --check lib/billing.js
	node --check lib/format.js
	node --check scripts/check-usage.js
	glib-compile-schemas --strict schemas/

install: check
	mkdir -p $(INSTALL_DIR)/schemas $(INSTALL_DIR)/lib $(INSTALL_DIR)/icons
	cp metadata.json extension.js prefs.js stylesheet.css $(INSTALL_DIR)/
	cp lib/*.js $(INSTALL_DIR)/lib/
	cp icons/*.svg $(INSTALL_DIR)/icons/
	cp schemas/*.xml $(INSTALL_DIR)/schemas/
	glib-compile-schemas $(INSTALL_DIR)/schemas/

uninstall:
	rm -rf $(INSTALL_DIR)

enable: install
	gnome-extensions enable $(UUID)

install-indicator: check
	mkdir -p $(HOME)/.config/autostart
	sed 's#@ROOT@#$(CURDIR)#g' data/grok-quota.desktop > $(HOME)/.config/autostart/grok-quota.desktop

indicator: check
	python3 scripts/indicator.py

pack: check
	gnome-extensions pack --force \
		--extra-source=lib \
		--extra-source=icons \
		--extra-source=stylesheet.css \
		--schema=schemas/org.gnome.shell.extensions.grok-quota.gschema.xml
