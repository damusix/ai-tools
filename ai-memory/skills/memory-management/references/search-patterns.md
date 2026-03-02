# Search Patterns Reference


## FTS5 Query Syntax

ai-memory uses SQLite FTS5 for full-text search. These operators work in `search_memories` and `search_observations`:

| Syntax | Meaning | Example |
|--------|---------|---------|
| `word` | Match token | `auth` |
| `"exact phrase"` | Match exact phrase | `"database migration"` |
| `word*` | Prefix match | `react*` matches react, reactive, reactivity |
| `term1 OR term2` | Match either | `postgres OR mysql` |
| `term1 AND term2` | Match both (default) | `auth AND jwt` |
| `NOT term` | Exclude | `auth NOT oauth` |
| `(a OR b) AND c` | Grouping | `(react OR solid) AND routing` |


## Search Strategies

**Broad to narrow:** Start with a general term, then add qualifiers.
```
auth                    → too many results
auth AND jwt            → narrower
"jwt refresh token"     → specific
```

**Tag discovery:** Use `list_tags` first to see what vocabulary exists, then filter by tag.

**Domain scoping:** Use `list_domains` to see domains, then pass `domain` parameter to `list_memories`.

**Prefix for variations:** Use `config*` to match config, configuration, configurable.


## Examples by Use Case

**Finding decisions:**
```
search_memories("decision AND database")
search_memories("chose OR decided OR picked")
list_memories(category: "decision")
```

**Finding patterns:**
```
search_memories("pattern AND error")
list_memories(category: "pattern", tag: "architecture")
```

**Finding solutions:**
```
search_memories("fix* AND deploy*")
list_memories(category: "solution")
search_memories("workaround OR fix OR solved")
```

**Finding preferences:**
```
list_memories(category: "preference")
search_memories("prefer* AND style")
```
