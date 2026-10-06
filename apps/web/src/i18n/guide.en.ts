// The guide to each level, in English. It is for someone who wants to learn and does not know how
// to solve a level: it says what is going on, what the idea is, and what to change, and so it
// gives the answer away. The hints in a level stay the gentle way in.
//
// Every figure here is a setting of the level or follows from one, and every line under `others`
// is a row of `packages/scenarios/test/attempts.ts`, which the tests run. If a level is retuned,
// read its guide again with the level's brief, hints and debrief.

/** What the guide says about one level. The level's own title and brief are not repeated. */
export interface LevelGuide {
  /** What is going on, and why the design the level starts from cannot cope. */
  problem: string;
  /** The idea that fixes it, with the name it goes by elsewhere. */
  idea: string;
  /** What to change on the canvas, in order. Together they make the level's reference design. */
  steps: string[];
  /** Why that is the best answer: what each change buys. */
  why: string;
  /** What else a player might try, and what comes of it. */
  others: string[];
}

export const guideEn: Record<string, LevelGuide> = {
  'first-traffic': {
    problem:
      'One instance works on 8 requests at a time and each takes about 40 ms, so it finishes about 200 a second. Traffic climbs to 300. ' +
      'From the moment more arrives than can be finished, the waiting room fills, everyone in it waits, and what does not fit is turned ' +
      'away: about a third of all requests. Watch the gauge on API. Waiting is hardly there at half load, and grows without limit as the ' +
      'gauge nears the load line.',
    idea:
      'Scale out: run more copies of the service and spread the calls over them. And leave room. Waiting does not grow in step with ' +
      'load. It stays small for a long time and then explodes close to 100% busy, which is why a service is run well below what it can do.',
    steps: [
      'Add a Load balancer from the parts on the left.',
      'Select the connection from Users to API and delete it. A client can call only one part, so the old connection has to go before a new one can be drawn.',
      'Connect Users to the balancer, and the balancer to API.',
      'Select API and set "Instances" to 2.',
    ],
    why:
      'Two instances finish about 400 a second, so 300 keeps them 75% busy: working, with room to spare. The balancer is what makes the ' +
      'second instance count, because without one every call still lands on the first. Two is also the smallest fleet that works, and ' +
      'the second star is for not paying for more.',
    others: [
      'A second instance and no balancer: it fails exactly as before. Nothing sends calls to the second one.',
      'A balancer in front of one instance: it fails as before. Nothing was added that does any work.',
      'Three instances behind a balancer: one star. It is fast, and it costs more than the second star allows.',
      'Four instances: it fails, on cost.',
    ],
  },
  'read-heavy': {
    problem:
      '450 requests a second arrive, and 95 in every 100 are reads. Each read is a query, and the database finishes about 330 a second ' +
      'at full speed: 4 cores, 12 ms a query. It cannot be made bigger. So it falls behind, the queries that pile up share its cores and ' +
      'all slow down, and over a third of requests fail.',
    idea:
      'Do not ask again for what you were just told. Readers want the same few popular items over and over, so a cache that remembers ' +
      'recent answers takes most of the reads off the database. This is called read-through caching, or cache-aside.',
    steps: [
      'Add a Cache from the parts on the left.',
      'Connect API to the Cache. The API now asks the cache first, and goes to the Database only when the cache does not have the item.',
      'Select the Cache and set "Items it can hold" to 2,000.',
    ],
    why:
      'There are 20,000 items, yet a cache holding 2,000 of them answers most reads, because those are the ones people ask for. The ' +
      'database is left with about a third of the load, well inside what it can do. A larger cache hits a little more often and costs ' +
      'more: once the favourites fit, the extra room buys almost nothing.',
    others: [
      'A cache of 100 items: it fails. Too few of the reads are for those hundred.',
      'A cache of 500 items: three stars as well, and a little cheaper. The answers are a little slower.',
      'A cache of 5,000 items: one star. It works, and costs more than the second star allows.',
    ],
  },
  'pool-party': {
    problem:
      'The database has 4 cores and a query takes 10 ms, so at full speed it finishes 400 a second, and only 300 are asked for. But the ' +
      'API opens as many connections as it likes. One burst puts more than four queries on the cores at once. They share the cores, so ' +
      'each takes longer; more arrive while they run; and the pile never clears. Flat out, the database finishes less work than it did ' +
      'when it was calm.',
    idea:
      'Limit how many queries the caller may have open at once. That limit is a connection pool. The waiting then happens in the API, in ' +
      'order, where it costs nothing, and the database only ever holds as many queries as it can run at full speed.',
    steps: ['Select the connection from API to Database.', 'Set "Connections per instance" to 5.'],
    why:
      "The right size is the database's, not the caller's: its number of cores, plus one. A connection is also busy while its query is " +
      'on the network, so exactly four leaves a core idle now and then. Five keeps all four cores working without crowding them.',
    others: [
      'A pool of 2 or 3: it fails. The API waits for connections while the database sits partly idle.',
      'A pool of 4: two stars. A pool of 6: three, like 5.',
      "A pool of 8: two stars. The queries start to get in each other's way.",
      'A pool of 32: it fails, like no limit at all.',
    ],
  },
  'slow-dependency': {
    problem:
      'A fifth of the traffic is purchases, 40 a second, and each calls Payments. When Payments takes two seconds a call, every purchase ' +
      "holds one of the Shop's slots for two seconds: 80 slots wanted, and the Shop has 32. Browsing never touches Payments, but it " +
      'queues behind those purchases and is turned away.',
    idea:
      'Never wait longer for a dependency than you can afford to. A timeout gives the slot back. A circuit breaker goes further and ' +
      'stops calling something that keeps failing. Both are ways of failing fast, so that one broken part does not take the rest with it.',
    steps: ['Select the connection from Shop to Payments.', 'Set "Give up after" to 300 ms.'],
    why:
      'At 300 ms a purchase holds its slot for a third of a second: 12 slots at a time instead of 80, so browsing never has to wait. The ' +
      'purchases still fail while Payments is slow, and nothing here can save them. The level asks that nothing else fails, and the stars ' +
      'are for how little browsing notices.',
    others: [
      'A timeout of one second: it fails. That is still 40 slots wanted, and there are 32.',
      'A timeout of 800 ms: one star. Of 700 ms: two.',
      'A breaker with the timeout left at three seconds: it fails. Payments is slow, not failing, so the breaker never sees a failure and never opens.',
      'A timeout of one second and a breaker: three stars. Now the slow calls count as failures, the breaker opens, and purchases fail at once.',
      'A timeout of 300 ms and three retries: it fails. Each retry holds the slot again.',
    ],
  },
  'retry-storm': {
    problem:
      'The API can finish about 530 requests a second and gets 400. For five seconds it is three times slower, and calls start to pass ' +
      'the 150 ms the users will wait. Every call that times out is tried again at once, up to three times: up to four times the ' +
      'traffic, for a service that is already behind. The calls that timed out are still in its waiting room, and it works through them ' +
      'for nobody. By now every call waits longer than the timeout, so every call is retried. The cause is gone and the storm feeds itself.',
    idea:
      'A retry is extra load at the worst possible moment. What ends a storm is less work: fewer retries, or turning calls away early, ' +
      'so that whatever is let in can still be answered in time. That is called load shedding. Waiting between retries, with some ' +
      'randomness, spreads them out but does not make them fewer.',
    steps: [
      'Select API and set "Waiting room, per instance" to 8.',
      'Select the connection from Users to API and set "Retries" to 2.',
      'On the same connection, set "Wait before the first retry" to 50 ms, "Each further wait is longer by" to 2, and "Randomise the wait" to 1.',
    ],
    why:
      'With room for only 8 waiting calls, a call that gets in is answered inside the timeout, and one that does not is refused at once, ' +
      'while a retry can still succeed. Nothing is worked on for nobody. Fewer retries, spaced out, keep the retries themselves from ' +
      'becoming the load.',
    others: [
      'No retries at all: one star. The storm cannot start, but every call that fails reaches the user.',
      'One retry: it fails. Twice the traffic is still more than the API can do.',
      'Waiting between retries and nothing else: it fails. They are spread out, not fewer.',
      'A waiting room of 8 or 32 with the three retries left as they are: three stars. The short waiting room is what matters.',
      'A timeout of three seconds, or a breaker: three stars. Either stops the retries from being made.',
    ],
  },
  'write-burst': {
    problem:
      'Every order is recorded in the Ledger before the customer is answered, and the Ledger records 100 a second: 4 at a time, 40 ms ' +
      'each. Normally 80 arrive. Then a sale brings 400 a second for ten seconds. Every customer is waiting on the Ledger, so the ' +
      'waiting fills up and four in ten are turned away.',
    idea:
      "Change what the customer waits for. Storing an order in a queue is instant; recording it can come later, at the worker's own " +
      'pace. The queue soaks up the burst and the workers pay it back afterwards. This is called asynchronous processing, or queue-based ' +
      'load levelling.',
    steps: [
      'Select the Ledger and delete it.',
      'Add a Queue and a Worker from the parts on the left.',
      'Connect Orders to the Queue, and the Queue to the Worker.',
      'Select the connection from Orders to the Queue and set "The caller" to "Hands it over and moves on".',
      'Select the Worker and set "Instances" to 2.',
    ],
    why:
      'The sale brings 4,000 orders in ten seconds and two worker instances record 200 a second, so about 2,000 are left in the queue ' +
      'when it ends. They then clear 120 a second more than arrives, and the queue is empty some 17 seconds later. One instance would ' +
      'clear only 20 a second more than arrives and would not finish in time; a third is more than the budget allows. Size workers for ' +
      'the catch-up, not for the burst.',
    others: [
      'A queue and one worker instance: it fails. More than a thousand orders are still unrecorded when the run ends.',
      'A queue and three instances: it fails, on cost.',
      'Two instances and a queue that holds only 500 messages: it fails. The queue fills during the sale and orders are lost.',
    ],
  },
  stampede: {
    problem:
      '1,500 reads a second arrive, nearly all for the same 40 products. The cache answers almost every one, so the database behind it ' +
      'is small: 8 cores and 40 ms a query, 200 a second. Then a deploy empties the cache. In the next second every request misses, and ' +
      'each goes to the database for an answer that another request is already fetching. Hundreds of copies of the same forty queries ' +
      'share eight cores, each takes seconds, and while they run every new request misses too.',
    idea:
      'When many requests miss the same item at once, let one of them fetch it and have the rest wait for that one answer. This is ' +
      'called single flight, or request coalescing. What it prevents is a cache stampede, also known as a thundering herd.',
    steps: [
      'Select the Cache and turn on "Fetch a missing item once, for everyone waiting on it".',
      'Select the connection from Catalog to Database and set "Connections per instance" to 8.',
    ],
    why:
      'Fetching each item once turns fifteen hundred queries into forty, and that alone earns two stars. The pool is the second ' +
      'defence. With 8 connections for 8 cores, the forty queries that do arrive run at full speed instead of sharing the cores, which is ' +
      'what the third star needs.',
    others: [
      'A pool of 8 and no single flight: one star. The database stays at full speed, and everyone still queues for it.',
      'A pool of 4 or of 16 and no single flight: it fails. One is too few to get through the queue, and the other lets the database be crowded.',
      'Single flight and no pool: two stars.',
    ],
  },
  'black-friday': {
    problem:
      'One instance handles 4 requests at a time at 20 ms each: 200 a second. Two are plenty for the 100 a second of a normal day. Then ' +
      'the sale takes traffic to 650 over thirty seconds. Two instances cannot carry that, and enough instances for the peak, running ' +
      'all day, cost more than the budget.',
    idea:
      'Autoscaling: let the service add instances when it is busy and give them back when it is not, so the peak is paid for only while ' +
      'it lasts. But it is always late. It sizes itself for load it has already seen, and a new instance takes ten seconds to start. ' +
      'Room to spare is how you buy that time: aim to keep fewer slots busy, and the order goes in earlier.',
    steps: [
      'Select Shop and turn on "Add and remove instances by itself".',
      'Set "Share of slots to keep busy" to 0.3, which is 30%.',
      'Set "Most instances" to 5.',
    ],
    why:
      'Aiming for 80% busy, the service orders more only when it is nearly full, and by the time they have started the climb has passed ' +
      'them. Aiming for 30%, it orders while most of its slots are still free, so new instances arrive before they are needed and nothing ' +
      'fails. The limit of five stops it ordering more than the peak needs, which keeps the average bill low enough for the third star.',
    others: [
      'Three instances all day: it fails at the peak. Four all day: it fails on cost.',
      'Scaling, aiming for 80% or 70% busy: it fails. The new instances arrive too late.',
      'Aiming for 50%: one star. A few requests still fail during the climb.',
      'Aiming for 30% with no limit on instances: two stars. Nothing fails, and the bill is too high for the third.',
      'Aiming for 25%: it fails, on cost. Room to spare is paid for.',
    ],
  },
  'node-down': {
    problem:
      '240 requests a second are shared by two instances that can each do 200, so each is 60% busy. It looks like room to spare. When ' +
      'one dies, the other is asked for 240 and can do 200. And for up to ten seconds the balancer has not noticed, and goes on sending ' +
      'half the calls to the dead one.',
    idea:
      'Spare capacity is measured after the failure you are planning for: run one instance more than the load needs. Then shorten the ' +
      'time the failure can be seen. A health check finds the dead instance; a retry on another instance hides it altogether. This is ' +
      'called N+1 redundancy.',
    steps: [
      'Select API and set "Instances" to 3.',
      'Select the Balancer and set "Check for dead instances every" to 1,000 ms.',
      'Select the connection from the Balancer to API and set "Retries" to 1.',
    ],
    why:
      'With three, two are left after the failure: room for 400 a second against 240. The retry is what makes the failure invisible. A ' +
      'call sent to the dead instance fails at once and is sent again to a live one, so no user sees an error. The faster check means ' +
      'the balancer stops sending calls there within a second, and few calls need the retry at all.',
    others: [
      'A third instance and nothing else: it fails. For ten seconds a third of the calls go to the dead one.',
      'Three instances checked every second: one star. Checked every 250 ms: two.',
      'Three instances and a retry, with the check left at ten seconds: three stars. The retry does the work.',
      'Two instances with fast checks and retries: it fails. One instance cannot carry the load.',
      'Four instances: it fails, on cost.',
    ],
  },
  'the-bill': {
    problem:
      'Nothing is failing here. Every part is several times larger than its load needs: 8 API instances, a database of 32 cores with 2 ' +
      'read replicas, a cache for 50,000 items when 5,000 exist, and 6 mailer instances. It costs $1,987 a month.',
    idea:
      'For each part, ask how busy it is at its busiest, and how busy it can be before waiting starts to grow. Size it to its load ' +
      'line at the peak: not to the average, and not to be safe. This is called rightsizing, or capacity planning.',
    steps: [
      'Run it once and read the gauges through the busy stretch, from 0:40 to 1:00. Most are nowhere near their load line.',
      'Select API and set "Instances" to 2.',
      'Select the Database. Set "Queries at full speed at once" to 8 and "Read replicas" to 0.',
      'Select the Cache and set "Items it can hold" to 5,000.',
      'Select the Mailer and set "Instances" to 2.',
    ],
    why:
      'At the peak 900 requests a second arrive. Two API instances carry that with room; one does not. The cache now holds every item ' +
      'there is, so more room would buy nothing, and with most reads answered there, 8 cores and no replicas are enough for the ' +
      'database. The mailer is different: it reads from a queue, so it only has to keep up on average. The queue holds the peak and the ' +
      'mailer catches up afterwards.',
    others: [
      'Half of everything: one star. A quarter of everything: two. Cutting every part alike leaves some too large.',
      'One API instance, a database of 4 or 6 cores, or a cache of 500 items: each fails. That part is now below its load.',
      'One mailer instance: it fails. Emails are still unsent when the run ends.',
      'A cache of 2,000 items: three stars as well.',
    ],
  },
  'luck-of-the-draw': {
    problem:
      'Ten instances each work on 2 requests at a time at 20 ms apiece: 100 a second each, 1,000 together. 850 arrive, so on ' +
      'average each is 85% busy and there is room. But the balancer picks at random, and random is lumpy. At any moment some ' +
      'instances have three or four calls and a queue while others stand idle, and a call sent to a busy one waits behind work ' +
      'that an idle one could have started at once.',
    idea:
      'Send each call where it will wait least. A balancer that knows how busy its instances are can do that; one that picks ' +
      'blindly cannot. Even a little knowledge goes a long way: comparing two instances picked at random, and taking the less ' +
      'busy, removes most of the waiting. That trick is known as the power of two choices; sending to the least busy of all is ' +
      'called least connections.',
    steps: ['Select the Balancer.', 'Set "How it picks an instance" to "The least busy".'],
    why:
      'With the least busy instance always chosen, a call queues only when every instance is busy, which at 85% is rare. The ' +
      'ten small queues behave like one shared queue in front of twenty slots, and the slowest requests take a third as long ' +
      'as before, on the same servers.',
    others: [
      'Each in turn: one star. The calls are shared out evenly, but they are not equally long, so an instance can still be handed a call while it is stuck on a slow one.',
      'The less busy of two picked at random: two stars. Nearly as good as looking at all of them, for much less looking.',
    ],
  },
  patience: {
    problem:
      'Search answers in 60 ms on average, but unevenly: half its answers take under 40 ms, and about one in six takes more ' +
      'than 100 ms. That is exactly where the site gives up. It calls each of those slow answers a failure and asks again, up ' +
      'to twice, while Search carries on with the first. Search has room for 233 calls a second and gets 200; the repeats push ' +
      'it past what it can do. Then everything is late, everything is retried, and it never recovers. Nothing broke. The ' +
      'timeout did this.',
    idea:
      'A timeout is a statement about how long a healthy answer can take. Set it from the slow end of what the service really ' +
      'does, its p99 or beyond, not from its average. Too short, and you fail requests that were about to succeed, and every ' +
      'retry adds load to a service that was fine.',
    steps: ['Select the connection from Site to Search.', 'Set "Give up after" to 600 ms.'],
    why:
      'The slowest one in a hundred healthy answers takes about 350 ms, so at 600 ms almost nothing is cut off. The two ' +
      'retries can stay: when a call really does fail they help, and when hardly any call times out they cost nothing. Search ' +
      'goes back to the 200 calls a second it can carry.',
    others: [
      'Taking out the retries and leaving the timeout at 100 ms: it fails. The storm is gone, and one request in four is still cut off.',
      'Waiting between retries: it fails. The repeats are spread out, and there are just as many.',
      'A timeout of 150, 200 or 300 ms: it fails. Each still cuts off enough healthy answers to overload Search.',
      'A timeout of one second or of three: three stars as well. Past the slow end of a healthy answer, longer changes nothing here. Slow dependency showed what a long timeout costs when the service really is slow.',
    ],
  },
  'full-house': {
    problem:
      'The ticket service handles 10 requests at a time at 40 ms each: 250 a second. During the sale 450 arrive. It cannot ' +
      'serve them all, and it is not allowed to grow. Left alone it fills its waiting room of 256, so everyone it does serve ' +
      'first waits about a second, and it still turns away everyone who does not fit.',
    idea:
      'When you cannot serve everyone, choose who waits. Turn the excess away at the door, at once, and the people you let in ' +
      'are served as they arrive. That is load shedding, and a rate limiter is the usual tool: it lets a set number of calls ' +
      'through each second and refuses the rest immediately.',
    steps: [
      'Add a Rate limiter from the parts on the left.',
      'Select the connection from Fans to Tickets and delete it.',
      'Connect Fans to the limiter, and the limiter to Tickets.',
      'Select the limiter and set "Calls let through per second" to 230.',
      'Set "Calls let through at once after a quiet spell" to 20.',
    ],
    why:
      'At 230 a second the service is busy but not full, so a request that gets in is answered almost as fast as the work ' +
      'itself takes. That is a little under what the room holds on purpose: at exactly 250 it is full all the time, and the ' +
      'queue comes back. The burst is the other half. A limiter saves up permission while it is quiet, and a hundred calls ' +
      'let in together at the start of the sale would be a queue that takes seconds to clear.',
    others: [
      'Letting 250 through, exactly what the room holds: it fails. With no slack the queue grows again.',
      'Letting 300 through: it fails, just as it does with no door at all.',
      'Letting 220 through: two stars. 210: one. The answers are no faster, and more people are turned away than need be.',
      'Letting 190 or fewer through: it fails. More than 45% are turned away.',
      '230 with the burst left at 100: it fails. The rush at the start of the sale fills the waiting room.',
    ],
  },
  'never-twice': {
    problem:
      'Every second 360 reads and 40 writes arrive, and one database server runs about 330 queries a second: 4 cores, 12 ms a ' +
      'query. It falls behind and most requests fail. The fix from Read-heavy does not work here. A cache answers a read that ' +
      'was made before, and with a million documents asked for evenly, almost no read was made before.',
    idea:
      'When reads do not repeat, add servers that can answer them. A read replica is a copy of the database that serves ' +
      'reads; writes still go to the one primary and are copied across. It suits a load that is mostly reading, and it is ' +
      'called scaling reads out. Count the replicas for the reads alone, because once there is one, the primary no longer ' +
      'serves any.',
    steps: [
      'Select the Database and set "Read replicas" to 2.',
      'Select the connection from API to Database and set "Connections per instance" to 10.',
    ],
    why:
      'With two replicas each gets 180 reads a second, a little over half of what it can run, and the primary is left with ' +
      'the 40 writes. The pool is the lesson of Pool party again: three servers have twelve cores between them, so the API may ' +
      'hold more connections than before, but with no limit at all a burst can still crowd one replica and tip it over.',
    others: [
      'A cache: it fails. Nothing is read twice, so it has nothing to give back.',
      'One replica: it fails. All 360 reads go to it, and that is as much too many for it as 400 queries were for the primary.',
      'Two replicas and no pool: it fails. A burst puts too many queries on one replica at once, and it does not recover.',
      'Two replicas and a pool of 5: it fails; the API waits for connections while cores stand idle. A pool of 6: one star. A pool of 32: it fails, like none.',
      'Three replicas: it fails, on cost.',
    ],
  },
  clockwork: {
    problem:
      'A hundred prices are each asked for twenty times a second, and the cache keeps each for exactly twenty seconds. When ' +
      'the site starts, all hundred are fetched in the same moment. So they all expire in the same moment and are all fetched ' +
      'again together: a hundred queries at once on a database of 4 cores that needs 40 ms for each. Until they are done, ' +
      'nobody gets a price. Twenty seconds later it happens again, and again, because being fetched together is what keeps ' +
      'them together.',
    idea:
      'Things that are stored at the same time with the same lifetime expire at the same time. Give each item a slightly ' +
      'different lifetime and they drift apart, so the store sees a steady trickle instead of a wave. This is called adding ' +
      'jitter to the expiry, and it applies to anything on a timer: caches, scheduled jobs, clients that all reconnect after ' +
      'an outage.',
    steps: ['Select the Cache.', 'Set "Randomise lifetimes" to 0.2.'],
    why:
      'A price now lives somewhere between sixteen and twenty seconds, so the hundred no longer run out together. The first ' +
      'time round they spread over four seconds, the next time over more, and within a minute the database is fetching about ' +
      'five prices a second, which it does without anyone waiting. No price is ever older than the twenty seconds allowed.',
    others: [
      'Randomised by 0.01 or 0.02: it fails. The prices drift apart too slowly to help within the run.',
      'By 0.05: two stars. By 0.1, by 0.5, or completely: three, like 0.2.',
      'Fetching a missing price only once is already on, and does not help: these are a hundred different prices, not one price asked for a hundred times.',
    ],
  },
  'nine-times': {
    problem:
      'Users call Web, and Web calls the API. Web gives the API 200 ms and tries twice more if a call fails. The user tries ' +
      'twice more as well, and every one of those tries is three calls by Web. So when the API has a bad five seconds, each ' +
      'request can turn into nine calls. The API can handle 375 a second and normally gets 100. Nine times that is 900, so it ' +
      'never clears its queue, every call is late, and every late call is retried.',
    idea:
      'Retries multiply down a chain of calls; they do not add. Two layers that each try three times make nine tries, and ' +
      'three layers would make twenty-seven. So retry in one layer only, the one closest to what fails, and let the others ' +
      'pass the failure on. This is sometimes called a retry budget: decide how much extra load the whole chain may create, ' +
      'not each layer by itself.',
    steps: ['Select the connection from Users to Web.', 'Set "Retries" to 0. Leave the two retries on the connection from Web to API.'],
    why:
      'Now the worst the API can be handed is three times its usual load, 300 calls a second, and it has room for 375. After ' +
      'the bad five seconds it works through what has piled up and is back to normal a few seconds later. The retries that ' +
      'remain are worth keeping: even a healthy API is now and then slower than 200 ms, and a second try answers those requests.',
    others: [
      'Two retries at the edge and none inside: three stars as well. What matters is that only one layer retries.',
      'One retry at each layer: it fails. It looks more careful than two at one layer, and is four times the load instead of three, more than the API can carry.',
      'No retries anywhere: it fails. The storm cannot start, but the requests that a healthy API answers late simply fail.',
      'Two at each layer with a wait between them: it fails. The calls are spread out, and there are still nine.',
      'Two at each layer and a circuit breaker on the connection to the API: three stars. The breaker stops the calls themselves instead of the retries.',
    ],
  },
  'wrong-suspect': {
    problem:
      'Web is turning away a quarter of all requests, and its gauge is at the top. But look at what it is doing: every one of ' +
      'its slots holds a request that is waiting for the API, and every slot of the API holds one that is waiting for the ' +
      'database. The database runs a query in 16 ms on 4 cores, so 250 a second, and 300 arrive. The shortage is at the back. ' +
      'It shows at the front because a call holds its place all the way up the chain while it waits.',
    idea:
      'The part that hurts is not always the part that is short. Before making anything bigger, follow the waiting: what is ' +
      'this part waiting for, and what is that one waiting for? The last part in the line, the one that is working and not ' +
      'waiting, is the bottleneck. The panel under the canvas that says where the time goes does this walk for you.',
    steps: [
      'Run it and read the panel that says where the time goes. It names the Database.',
      'Select the Database and set "Queries at full speed at once" to 6.',
      'Select the connection from API to Database and set "Connections per instance" to 7.',
    ],
    why:
      'Six cores run 375 queries a second, so 300 keeps the database 80% busy and nothing waits for long. The pool has to ' +
      'follow: it was 5 for a database of four cores, and left there it would let only five queries run at once and leave a ' +
      'core idle. Seven is the six cores plus one, as in Pool party. Web and the API needed nothing. They empty as soon as the ' +
      'database keeps up.',
    others: [
      'More slots on Web, or a second Web instance: it fails, and costs more. More requests get in, to wait for the same database.',
      'A second API instance: it fails, and worse than before. Two instances open twice the connections, and the database slows down under them.',
      'A larger pool, or none: it fails, for the same reason.',
      'Five cores: it fails; that is barely more than the load. Six cores with the pool left at 5: it fails too.',
      'Eight cores and a pool of 9: one star. It works, and costs more than it needs to.',
      'A read replica: it fails. One replica takes all the reads and is as short as the primary was, and it costs more than two extra cores.',
    ],
  },
  failover: {
    problem:
      'There is one database server, and at twenty seconds it fails. Fifteen seconds pass before the database can be used ' +
      'again, and in that time every request fails: browsing, which only reads, and buying, which writes. That is 300 ' +
      'requests a second for fifteen seconds.',
    idea:
      'Two different things have stopped, and they need two different answers. Reads need a second copy to read from: a ' +
      'replica, which also takes over as the new primary. Writes cannot be saved that way, because while the new primary is ' +
      'being chosen there is nowhere to write. They need somewhere to wait: a queue, with a worker that writes each purchase ' +
      'down once the database is back. A user cannot wait fifteen seconds. A message can.',
    steps: [
      'Select the Database and set "Read replicas" to 1.',
      'Add a Queue and a Worker from the parts on the left.',
      'Connect Shop to the Queue, the Queue to the Worker, and the Worker to the Database.',
      'Select the connection from Shop to the Queue. Set "Used by" to "Writes only" and "The caller" to "Hands it over and moves on".',
      'Select the connection from Shop to the Database and set "Used by" to "Reads only".',
      'Select the connection from the Worker to the Database. Set "Retries" to 5 and "Wait before the first retry" to 1,000 ms.',
    ],
    why:
      'The replica answers every read while the primary is gone, and then becomes the primary, so browsing never notices. ' +
      'Purchases go into the queue and the customer is answered at once. The worker tries to write each one, fails, and waits: ' +
      'one second, then two, then four, eight and sixteen, which is longer than the fifteen seconds the database is away. ' +
      'When it is back, the purchases that piled up are written within a few seconds. Nothing is lost and nobody was kept waiting.',
    others: [
      'A replica and nothing else: it fails. Browsing survives, and every purchase made in those fifteen seconds is refused.',
      'A replica, and the shop itself retrying its writes with long waits: it fails badly. Each waiting purchase holds a slot of the shop, the slots run out, and browsing fails too.',
      'The queue and a patient worker, but no replica: it fails. Purchases are safe and nobody can browse.',
      'A queue with a worker that does not retry, or that retries five times at once: it fails. The worker uses up every chance a purchase has in a few milliseconds and sets it aside, and hundreds are lost.',
      'Two worker instances: one star. One is enough, and the second is paid for.',
      'Two replicas: it fails, on cost.',
    ],
  },
};
