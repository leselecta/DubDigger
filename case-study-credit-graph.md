# Following the Threads
### A digging tool built on music credits — case study

---

## The premise

Every record is made by more people than the cover admits. A producer, a mixing engineer, a bassist who turns up on four other records you already love. That web of credits is how crate-diggers actually find music (follow the engineer, not the algorithm), but no consumer tool exposes it well. The data exists, exhaustively, in Discogs. It just isn't shaped for digging.

I set out to build the tool I wanted to use: **type an artist, see who they worked with and what labels they released on, then click any of those to keep going.** A map of scenes, drawn from credits.

---

## Framing the problem

The obvious version of this product is a graph. Artists as nodes, collaborations as edges, a force-directed cloud you can pan around. It looks impressive in a screenshot.

I went looking for whether it already existed, and it does: a Discogs-powered collaboration-graph tool, fully built, millions of artists indexed. Rather than treat that as a dead end, I used it as research. I ran my own reference queries through it and paid attention to where it left me unsatisfied.

Two findings shaped everything after:

**The graph was the weakest part.** A node cloud answers "is everything connected" (yes, always) but not the question I actually had: *who matters here?* It made me squint and pan when I wanted to read.

**Its table was a log, not an overview.** One row per credit, unranked. Technically complete, practically useless for getting the shape of a career at a glance.

That reframed the product. The differentiator wasn't a prettier graph. It was **aggregation**: the same data, ranked and summarised so it answers a question on sight. A design problem, not a data problem.

---

## The core decision: ranked lists over graphs

The central bet of the project is that for "who should I dig into next," a ranked list beats a graph.

A collaborator list sorted by number of shared releases puts the person who appears on nine records at the top, where they belong. Frequency *is* the signal, and a list encodes it natively; a graph hides it in edge thickness you have to eyeball. Labels ranked by release count with date ranges show a career arc in five lines. Roles grouped (producer vs. engineer vs. remixer) separate different kinds of creative relationship that a graph flattens into identical lines.

The graph didn't disappear. It got demoted to one specific job it's genuinely good at (the connection path between two artists) and pushed to a later phase. Everything the daily loop depends on is tabular.

This is the decision I'd defend hardest, because it's counterintuitive: I made the product *less* visually impressive on purpose, because the impressive version answered the wrong question.

---

## Designing for the actual user

The user here is not a casual listener. They read Discogs pages for fun. That single fact drove the interface:

**Density is a feature.** Small type, tight rows, a lot on screen. I fought the framework's default whitespace the whole way, designing for someone who wants information per scroll, not breathing room.

**One click to pivot.** Every person, label, and release is a link to its own page. Digging is a sequence of hops, not a query you compose. The interaction model is the product: you follow threads.

**Absence shown honestly.** Credit data is contributed by volunteers, so it's uneven, and silently so. A "no collaborators" result might mean solo work or might mean nobody's entered the credits yet. Those are different, and the interface has to say which. An empty result that looks like an answer is worse than an honest "no data recorded here." This principle came straight from distrusting my own data, and it's the kind of thing that separates a tool you trust from one you don't.

---

## Scoping with Gall's Law

> A complex system that works is invariably found to have evolved from a simple system that worked.

I had an ambitious version in mind: two data sources (Discogs plus MusicBrainz), a role-normalisation layer to reconcile their vocabularies, alias resolution to collapse an artist's many identities, provenance markers on every credit. All defensible. All slow.

Gall's Law gave me permission to not build it yet. The rule isn't "start small," it's "the working complex system *evolved from* a working simple one", so the simple version has to genuinely work on its own terms, not be a stub of the big one.

So v1 is deliberately one source (Discogs, for its granularity), two entities (artist and label), and no graph. Tracks surface *through* collaborations and labels rather than being a top-level thing to manage. The dual-source model, normalisation, and graph are explicitly written down as *out of scope*: not forgotten, but earned later, each as an evolution of a core that already works.

Writing the exclusions down was itself a design act. It's how "feature parity plus improvements" stops eating the timeline before anything ships.

---

## Letting architecture serve simplicity

One decision I'm quietly proud of is moving all the heavy work offline. The Discogs data dump is enormous, over 100 GB of XML uncompressed. Instead of standing up infrastructure to handle that, I process it once on my own machine: stream-parse it, keep only the handful of fields the tool needs, filter to the corpus I care about, and precompute the rankings into a small read-only database.

It held up at full scale. Two passes over 19,341,287 releases take about an hour on a laptop, and what the server actually reads is a 0.89 GB file: 1,025,881 releases, 420,575 artists, 113,952 labels, with 5.1 million ranked collaborator rows already computed. No database server, no cache, no search cluster. The web app has one job, which is `SELECT`.

The result is that the *product* is trivial to run: a single process reading a small file, hostable on the cheapest box there is. The complexity lives in a one-off ingest step the user never touches. That boundary, hard work offline and a simple thing online, is what keeps the whole system honest with Gall's Law. The server stays trivial no matter how interesting the tool gets.

---

## Where the data pushed back

The part I didn't anticipate is that defining the corpus turned out to be the hardest design problem in the project, and the one that most needed judgement rather than code.

The plan was clean: filter on dub techno styles, take the artists, take their labels, expand one hop. The plan worked. It also let in Frank Sinatra, Elvis Presley, Iron Maiden and Mozart.

Each arrived through a route that was individually reasonable. A tribute album was vouched for by a photo archivist credited on eleven records that genuinely are in the scene. Luciano re-edited Nina Simone, which made her a seed artist off four releases in five thousand, which made the reissue labels carrying her look like scene labels, which admitted their whole catalogues. Mozart is credited "Composed By" on records that sample him. Every step is a real credit on a real record. The corpus was behaving exactly as specified and producing an answer no digger would accept.

**What fixed it was measuring rather than guessing.** There was no clean threshold to read off a distribution, so I pinned every dial to acts whose right answer I already knew. Massive Attack does 26.9% of its work in the seed and belongs. The Clash does 8.9% and belongs, because *Sandinista!* is half dub. Spice Girls do 0.46% and do not. Two orders of magnitude separate the two groups, and nothing a sceptic would think to type sits in between, which is what made 2% defensible and 10% wrong: 10% cuts The Clash.

Those pinned cases are now an acceptance test that runs after every rebuild and fails the build if a dial drifts. It checks the things a digger would actually judge the tool by, in their terms: fourteen labels that define the scene must be in, seven budget compilation outfits must be out, eight acts must grade as central, ten must not.

**The more interesting decision was when to stop.** After three rules Mozart was still there, on 85 releases that really do credit someone in the scene. A fourth rule would have started cutting real neighbours to chase a shrinking tail.

So I stopped pruning and made the interface carry it instead. Every artist is graded by how much of their output sits in the scene, and the ones with none of it are labelled by how they got here: collaborator, label mate, or both. Mozart is present and visibly peripheral.

That turned out to be the same principle as showing absence honestly, which I'd written down at the start and thought was only about missing credits. Being peripheral is a fact about the data. Hiding it would have been a lie about what the data says, told to make the tool look tidier. The interface should report what is there, including how weak a connection is.

The same lesson showed up in miniature with Basic Channel, the most important act in the scene. The credits alone cannot say that Basic Channel *is* Moritz von Oswald and Mark Ernestus: their releases credit Moritz twice, as a cutting engineer, and Ernestus not at all. Discogs states the relationship outright in a different part of the dump, so the fix was to read what was already there. But it is kept in its own section, never merged into the collaborator list, because being the same person is not the same fact as having worked together, and a tool built on credits has no business blurring the two.

---

## Future considerations: Graph view (v2)

The graph isn't dead, it's demoted. There is one question it answers better than any list: *how are these two artists connected?* A path of three hops through a shared engineer is a shape, and shapes are what graphs are for. That is worth building.

What it must not become is the front door. The daily loop is "who matters here", the ranked list answers it on sight, and a graph would put panning and squinting back in front of an answer the user could have read. So if it ships, it ships as a second view on a page that already works without it, for the one job the lists genuinely do badly.

The data is already there. Collaborator pairs with shared-release counts are precomputed, so the edges exist and are weighted. That is deliberate: v1 built the thing that made v2 cheap, which is the Gall's Law point rather than a lucky accident.

---

## What this demonstrates

- **Reframing via competitive research.** Using an existing product as a probe to find the real gap, rather than being scared off by it or copying it.
- **A defensible core bet.** Choosing ranked, aggregated views over the flashier graph, because it answers the user's actual question, and being able to say why.
- **Designing for a specific user.** Density, pivoting, and honest data-absence, all driven by who the digger actually is.
- **Disciplined scoping.** Gall's Law used not as a slogan but as a scoping tool, with the hard parts deferred deliberately and visibly.
- **Architecture in service of the experience.** Pushing complexity offline so the product itself stays simple.
- **Judgement where the data won't decide for you.** Corpus thresholds pinned to acts whose right answer is known, turned into an acceptance test, and a deliberate decision about when to stop tuning and let the interface carry the ambiguity instead.

The through-line: the best decision in the project was to make it *less* impressive on the surface, because a digging tool is judged by whether it helps you dig, not by how the screenshot looks.
