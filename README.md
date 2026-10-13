# Grok Quota

Extension GNOME Shell qui affiche le quota de l'abonnement Grok dans la barre supérieure, avec la part consommée par le **chat**, **Grok Build** et les **autres usages** (Imagine, tâches, API, etc.).

Le chiffre du panneau est le pourcentage déjà utilisé du pool de la période. Le menu détaille les trois parts. Elles portent sur le même pool : 24 % Build et 16 % Chat font un total de 40 %, pas deux jauges indépendantes.

```
Grok · SuperGrok
ada@example.com

Hebdomadaire          40 %
Chat                  16 %
Build                 24 %
Autres                 0 %
Renouvellement : mer. 14 oct., 17:33 (dans 1 j)
```

## Prérequis

- GNOME Shell **42** (Ubuntu 22.04). Les versions 45 et suivantes utilisent un autre format d'extension.
- Une session Grok Build ouverte : `grok login`.
- Les jetons sont lus dans `~/.grok/auth.json`. L'extension ne les réécrit pas et ne les renouvelle pas.

## Installation

```bash
make install
```

Cela copie l'extension dans `~/.local/share/gnome-shell/extensions/grok-quota@ygille`. Rechargez GNOME Shell pour qu'il la voie. Sous X11 : `Alt+F2`, tapez `r`, validez. Les applications restent ouvertes. Sous Wayland, fermez la session puis reconnectez-vous. Activez ensuite **Grok Quota** dans les extensions, ou lancez `gnome-extensions enable grok-quota@ygille`. `make uninstall` retire le dossier.

Sur un poste où `org.gnome.shell.enabled-extensions` est verrouillé par l'administrateur, GNOME refuse d'activer une extension installée par l'utilisateur. L'indicateur de barre passe alors par les indicateurs d'applications, déjà présents sur Ubuntu :

```bash
make install-indicator
python3 scripts/indicator.py
```

`make install-indicator` ajoute un démarrage automatique. Le libellé de la barre est le pourcentage total. Le menu donne Chat, Build et Autres.

Pour vérifier le quota dans un terminal :

```bash
node scripts/check-usage.js
node scripts/check-usage.js --json
```

## Utilisation

Le panneau affiche le pourcentage total. Il passe à l'orange à 70 % et au rouge à 90 %. Ces seuils se règlent dans les préférences, ainsi que l'intervalle de lecture (5 minutes par défaut, au minimum 60 secondes).

Le menu propose **Actualiser**, **Ouvrir l'usage** (la page usage de grok.com) et **Préférences**.

| Réglage | Rôle |
| --- | --- |
| Intervalle | Secondes entre deux lectures |
| Seuils | Couleur du pourcentage dans le panneau |
| Dossier Grok | Chemin qui contient `auth.json`. Vide : `~/.grok`, ou `GROK_HOME` s'il est visible par GNOME Shell |
| URL du proxy | Vide : `https://cli-chat-proxy.grok.com/v1`. À remplir pour un proxy d'entreprise (`GROK_CLI_CHAT_PROXY_BASE_URL`) |

La ligne de crédit prépayé et la ligne à la demande n'apparaissent que si le compte en a.

## D'où viennent les chiffres

L'extension envoie le jeton de `~/.grok/auth.json` au même point que Grok Build :

`GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`

Le nom du forfait (`SuperGrok`, `SuperGrok Heavy`, …) vient de `GET /v1/settings`, champ `subscription_tier_display`.

Les produits renvoyés sont regroupés ainsi :

| Produit | Ligne du menu |
| --- | --- |
| `GrokChat` | Chat |
| `GrokBuild` | Build |
| Imagine, tâches, API, et tout autre nom | Autres |

C'est l'API interne du client, pas une API publique. xAI peut en changer la forme. Le classement Chat / Build / Autres est alors conservé pour les noms connus, et un produit nouveau tombe dans Autres.

Si la session a expiré (environ sept jours), le menu le dit. Relancez `grok login` : Grok renouvelle le fichier, l'extension le relit.

## Développement

```bash
make test
make check
```

`lib/auth.js`, `lib/billing.js` et `lib/format.js` ne dépendent pas de GNOME. Les tests Node couvrent le classement des produits et le choix du jeton. `extension.js` est le panneau GNOME 42 (Soup 2, `enable` / `disable`).

```
lib/            lecture du quota, sans interface
extension.js    extension GNOME Shell 42
prefs.js        préférences de l'extension
schemas/        réglages GSettings
scripts/        aperçu terminal et indicateur de barre
data/           entrée de démarrage automatique
tests/          tests du classement
```

## Licence

MIT. Voir [LICENSE](LICENSE).
