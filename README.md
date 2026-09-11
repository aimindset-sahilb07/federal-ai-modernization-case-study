# Federal Benefits Modernization — AI-Accelerated Migration

A five-chapter case study on AI-accelerated legacy modernization in a regulated
federal environment: Java and DB2 to Postgres, and what integration testing
revealed about the distance between *generated* and *behaviorally equivalent*.

**Live:** https://aimindset-sahilb07.github.io/federal-ai-modernization-case-study/

```
index.html       the case study
tokens.css       the design system: closed set of allowed values
primitives.css   the design system: 9 layout primitives + contracts
check.mjs        the pre-publish gate
```


## The design system

The page is not hand-styled. It is built on a small system, because the first
version of this page was hand-styled and it produced a long tail of defects:
nine near-identical greys, a dozen arbitrary spacing values, a 62px icon inside
a 58px grid track, a `height:100%` that spilled a card into the next section.
None of those were taste problems. Nothing in the file prevented drift.

