# Changelog

## 1.0.0

### Features

- **add changelog command and update docs** [#a40f4d0](https://github.com/damusix/ai-tools/commit/a40f4d0081e030840a8367f00e7d069188843658)
- **add Go-based compound Bash approver plugin** [#51b9c45](https://github.com/damusix/ai-tools/commit/51b9c4521161bf34789b99f0b01f9bc70cdcb5ee)
### Bug Fixes

- **expand home-based permission matching for skill paths** [#c06a802](https://github.com/damusix/ai-tools/commit/c06a802f35a6a8783b26e5328bcc5460b7ed003b)
- **register auto-approve-compound-bash in marketplace** [#a2fd988](https://github.com/damusix/ai-tools/commit/a2fd98803c5a9484d568362adee5286c99362408)
  The root marketplace.json only listed ai-memory, making the
  auto-approve plugin invisible to users installing from this
  marketplace. Add it and remove the nested marketplace.json that
  was left over from the plugin's standalone repo.