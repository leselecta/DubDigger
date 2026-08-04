# Following the Threads
### A digging tool built on music credits — case study

---

## The premise

Every record is made by more people than the cover admits. A producer, a mixing engineer, a bassist who turns up on four other records you already love. That web of credits is how crate-diggers actually find music — follow the engineer, not the algorithm — but no consumer tool exposes it well. The data exists, exhaustively, in Discogs. It just isn't shaped for digging.

I set out to build the tool I wanted to use: **type an artist, see who they worked with and what labels they released on, then click any of those to keep going.** A map of scenes, drawn from credits.

---

## Framing the problem

The obvious version of this product is a graph. Artists as nodes, collaborations as edges, a force-directed cloud you can pan around. It looks impressive in a screenshot.

I went looking for whether it already existed, and it does — a Discogs-powered collaboration-graph tool, fully built, millions of artists indexed. Rather than treat that as a dead end, I used it as research. I ran my own reference queries through it and paid attention to where it left me unsatisfied.

Two findings shaped everything after:

**The graph was the weakest part.** A node cloud answers "is everything connected" (yes, always) but not the question I actually had: *who matters here?* It made me squint and pan when I wanted to read.

**Its table was a log, not an overview.** One row per credit, unranked. Technically complete, practically useless for getting the shape of a career at a glance.

That reframed the product. The differentiator wasn't a prettier graph. It was **aggregation** — the same data, ranked and summarised so it answers a question on sight. A design problem, not a data problem.

---

## The core decision: ranked lists over graphs

The central bet of the project is that for "who should I dig into next," a ranked list beats a graph.

A collaborator list sorted by number of shared releases puts the person who appears on nine records at the top, where they belong. Frequency *is* the signal, and a list encodes it natively; a graph hides it in edge thickness you have to eyeball. Labels ranked by release count with date ranges show a career arc in five lines. Roles grouped — producer vs. engineer vs. remixer — separate different kinds of creative relationship that a graph flattens into identical lines.

The graph didn't disappear. It got demoted to one specific job it's genuinely good at — the connection path between two artists — and pushed to a later phase. Everything the daily loop depends on is tabular.

This is the decision I'd defend hardest, because it's counterintuitive: I made the product *less* visually impressive on purpose, because the impressive version answered the wrong question.

---

## Designing for the actual user

The user here is not a casual listener. They read Discogs pages for fun. That single fact drove the interface:

**Density is a feature.** Small type, tight rows, a lot on screen. I fought the framework's default whitespace the whole way — designing for someone who wants information per scroll, not breathing room.

**One click to pivot.** Every person, label, and release is a link to its own page. Digging is a sequence of hops, not a query you compose. The interaction model is the product: you follow threads.

**Absence shown honestly.** Credit data is contributed by volunteers, so it's uneven — and silently so. A "no collaborators" result might mean solo work or might mean nobody's entered the credits yet. Those are different, and the interface has to say which. An empty result that looks like an answer is worse than an honest "no data recorded here." This principle came straight from distrusting my own data, and it's the kind of thing that separates a tool you trust from one you don't.

---

## Scoping with Gall's Law

> A complex system that works is invariably found to have evolved from a simple system that worked.

I had an ambitious version in mind: two data sources (Discogs plus MusicBrainz), a role-normalisation layer to reconcile their vocabularies, alias resolution to collapse an artist's many identities, provenance markers on every credit. All defensible. All slow.

Gall's Law gave me permission to not build it yet. The rule isn't "start small," it's "the working complex system *evolved from* a working simple one" — so the simple version has to genuinely work on its own terms, not be a stub of the big one.

So v1 is deliberately one source (Discogs, for its granularity), two entities (artist and label), and no graph. Tracks surface *through* collaborations and labels rather than being a top-level thing to manage. The dual-source model, normalisation, and graph are explicitly written down as *out of scope* — not forgotten, but earned later, each as an evolution of a core that already works.

Writing the exclusions down was itself a design act. It's how "feature parity plus improvements" stops eating the timeline before anything ships.

---

## Letting architecture serve simplicity

One decision I'm quietly proud of is moving all the heavy work offline. The Discogs data dump is enormous — over 100 GB of XML uncompressed. Instead of standing up infrastructure to handle that, I process it once on my own machine: stream-parse it, keep only the ~15% of fields the tool needs, filter to the corpus I care about, and precompute the rankings into a small read-only database.

The result is that the *product* is trivial to run — a single process reading a small file, hostable on the cheapest box there is. The complexity lives in a one-off ingest step the user never touches. That boundary — hard work offline, simple thing online — is what keeps the whole system honest with Gall's Law. The server stays trivial no matter how interesting the tool gets.

---

## Future considerations: Graph view (v2)

While the ranked list view is the core of the v1 product, there is potential to introduce a graph visualization as a complementary feature in a future v2 release. The graph view could offer an additional perspective on the data, allowing users to explore connections and relationships between artists and labels in a more visual and interactive way.

However, it's important to note that the graph view should not replace the ranked lists, but rather serve as an optional enhancement. The ranked lists remain the primary interface for answering the key question of "who matters here" and providing a clear overview of an artist's collaborations and label associations.

When considering the graph view for v2, careful design and implementation will be crucial to ensure that it adds value to the user experience without compromising the simplicity and effectiveness of the ranked lists. The graph should be thoughtfully integrated into the existing interface, with clear visual cues and interactions to switch between the list and graph views.

As with any significant feature addition, the graph view should be approached iteratively, starting with a minimal viable implementation and gradually expanding its capabilities based on user feedback and usage patterns. Performance and usability should be key considerations throughout the development process.

Ultimately, the decision to include a graph view in v2 will depend on a careful assessment of its potential benefits, the resources required for implementation, and the overall alignment with the product's goals and user needs.

---

## What this demonstrates

- **Reframing via competitive research** — using an existing product as a probe to find the real gap, rather than being scared off by it or copying it.
- **A defensible core bet** — choosing ranked, aggregated views over the flashier graph, because it answers the user's actual question, and being able to say why.
- **Designing for a specific user** — density, pivoting, and honest data-absence, all driven by who the digger actually is.
- **Disciplined scoping** — Gall's Law used not as a slogan but as a scoping tool, with the hard parts deferred deliberately and visibly.
- **Architecture in service of the experience** — pushing complexity offline so the product itself stays simple.

The through-line: the best decision in the project was to make it *less* impressive on the surface, because a digging tool is judged by whether it helps you dig — not by how the screenshot looks.
