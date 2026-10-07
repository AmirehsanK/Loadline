// The guide to each level, in English. It is for someone who wants to learn and does not know how
// to solve a level: it says what is going on, what the idea is, and what to change, and so it
// gives the answer away. The hints in a level stay the gentle way in.
//
// Every figure here is a setting of the level or follows from one, and every line under `others`
// is a row of `packages/scenarios/test/attempts.ts`, which the tests run. If a level is retuned,
// read its guide again with the level's brief, hints and debrief.
//
// A lesson is written for someone who has not met these parts before. So before it says what is
// wrong, it says what each part on the canvas is and what the words mean, and after the steps it
// says what each setting they touched does. A lesson repeats what an earlier one explained: a
// reader may open any of them first.

/** Something named, and what it is. */
export interface GuideEntry {
  term: string;
  text: string;
}

/** What the guide says about one level. The level's own title and brief are not repeated. */
export interface LevelGuide {
  /**
   * The parts in this level and what each one is and does here. A part the level starts with goes
   * by the name it has on the canvas, and one the player adds by the name of its kind. A test
   * checks both, and that no part the level starts with is left out.
   */
  parts: GuideEntry[];
  /** The words this lesson uses that a newcomer may not know. */
  words: GuideEntry[];
  /** What is going on, and why the design the level starts from cannot cope. */
  problem: string;
  /** The idea that fixes it, with the name it goes by elsewhere. */
  idea: string;
  /** What to change on the canvas, in order. Together they make the level's reference design. */
  steps: string[];
  /** What each setting the steps change does, by its label in the inspector, which a test checks. */
  settings: GuideEntry[];
  /** What to look at while it runs, before the change and after it. */
  watch: string[];
  /** Why that is the best answer: what each change buys. */
  why: string;
  /** What else a player might try, and what comes of it. */
  others: string[];
}

export const guideEn: Record<string, LevelGuide> = {
  'first-traffic': {
    parts: [
      {
        term: 'Users',
        text:
          'A client. It stands for everyone using the system, and it is where requests come from. It sends them at a set rate ' +
          'whether or not answers come back, as a real crowd does. Here the rate climbs to 300 a second. It is fixed: this is ' +
          'the load you have to carry.',
      },
      {
        term: 'API',
        text:
          'A service: a program that does some work for each request and then answers. One running copy of it is an instance. ' +
          'An instance works on 8 requests at a time, and each of those places is a slot. A request that finds every slot taken ' +
          'waits in the waiting room, which holds 64, and one that finds that full as well is turned away at once.',
      },
      {
        term: 'Load balancer',
        text:
          'The part you will add. It does no work of its own. It stands in front of a service and hands each call to one of ' +
          'its instances, so that they share the load.',
      },
    ],
    words: [
      { term: 'Request', text: 'One thing a user asks for: a page, a search, a purchase. It succeeds if an answer comes back in time, and fails if it does not.' },
      {
        term: 'Capacity',
        text:
          'How many requests a part can finish each second. For a service it is the number of slots divided by the time one ' +
          'request takes: 8 slots at 40 ms each finish about 200 a second.',
      },
      {
        term: 'How busy',
        text:
          'The share of slots in use, which is what the gauge on a part shows. 300 requests a second where there is room for ' +
          '400 is 75% busy. The line across the gauge, the load line, is at 80%.',
      },
      {
        term: 'p99',
        text:
          'The level asks for 99% of requests under 500 ms. Line up every answer from the fastest to the slowest: p99 is the ' +
          'time of the one that is 99% of the way along. It is what the unlucky requests get, and it is the first number to go ' +
          'bad when a queue forms.',
      },
    ],
    settings: [
      {
        term: 'Instances',
        text:
          'How many copies of the service are running. Each has its own slots and its own waiting room, and each is paid for ' +
          'by the month. By itself the setting changes nothing: with no balancer in front, every call still goes to the first copy.',
      },
    ],
    watch: [
      'Before you change anything, press Run and watch the gauge on API while traffic climbs, from 0:15 to 0:30. Once it passes the load line, a count of waiting requests appears on the part and grows, and soon after that the Failed number under the canvas starts to rise.',
      'After the change, the same climb leaves the gauge at about three quarters. Nothing waits for long, and p99 stays well under 500 ms.',
      'Look at the cost under the canvas as well. It went up with the second instance: that is what room to spare costs.',
    ],
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
    parts: [
      {
        term: 'Readers',
        text:
          'A client: the people using the site. They send 450 requests a second, and 95 in every 100 only read. There are ' +
          '20,000 different items to ask about, but demand is very uneven: a few favourites get most of the requests.',
      },
      {
        term: 'API',
        text:
          'A service. Here it does very little itself, about 2 ms of work, and then asks the database for the item, holding ' +
          'its slot while it waits for the answer.',
      },
      {
        term: 'Database',
        text:
          'Where the data is kept. Each read or write is a query, and a query runs on a core. This one has 4 cores and a query ' +
          'takes about 12 ms, so at full speed it finishes about 330 a second. Given more queries than cores, they share the ' +
          'cores and every one of them slows down. In this level it cannot be changed.',
      },
      {
        term: 'Cache',
        text:
          'The part you will add. A small, fast memory of recent answers. The API asks it first. If the item is there, which is ' +
          'a hit, the answer comes back at once. If it is not, a miss, the API asks the database and the cache remembers the ' +
          'answer for the next reader.',
      },
    ],
    words: [
      {
        term: 'Read and write',
        text: 'A read asks for data and changes nothing, so the answer one reader got will do for the next. A write changes data, and has to reach the database.',
      },
      { term: 'Query', text: 'One question put to a database, or one change made to it.' },
      { term: 'Share of hits', text: 'The share of reads the cache answered by itself. The Cache shows it on the canvas while the level runs.' },
    ],
    settings: [
      {
        term: 'Items it can hold',
        text:
          'The size of the cache. When it is full, the item that has gone longest without being asked for is dropped to make ' +
          'room for a new one. A larger cache costs more.',
      },
    ],
    watch: [
      'Before the change, the gauge on Database is at the top and the part says how many queries too many it has at once. Over a third of requests fail.',
      'After it, watch the first seconds closely. The cache starts empty, so the database carries everything. Then the share of hits on the Cache climbs and the gauge on Database comes down.',
      'Try a smaller cache and a larger one and compare the share of hits. It rises quickly at first and then hardly at all: that is the uneven demand at work.',
    ],
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
    parts: [
      { term: 'Users', text: 'A client, sending 300 requests a second. It is fixed.' },
      {
        term: 'API',
        text:
          'A service with slots to spare: 128 of them. It does 1 ms of work and then runs a query on the database, holding its ' +
          'slot until the answer is back.',
      },
      {
        term: 'Database',
        text:
          'Stores the data. It has 4 cores and a query takes 10 ms, so at full speed it finishes 400 a second. It accepts ' +
          'hundreds of connections, and that is the trouble: accepting a query is not the same as having a core free to run it.',
      },
    ],
    words: [
      { term: 'Connection', text: 'The line a caller keeps open to another part while a call is in progress. One connection carries one query at a time.' },
      {
        term: 'Connection pool',
        text:
          'A fixed number of connections that the caller shares out. A request that needs the database while all of them are in ' +
          'use waits, in order, for one to be handed back.',
      },
      {
        term: 'Sharing cores',
        text:
          'Four cores run four queries at once. Forty queries on four cores take turns, so each takes about ten times as long, ' +
          'and a little more is lost in switching between them. That is why a crowded database finishes less than a calm one.',
      },
    ],
    settings: [
      {
        term: 'Connections per instance',
        text:
          'The size of the pool on this connection: how many calls each instance of the caller may have in progress to the ' +
          'other part at once. 0 means no limit, which is how the level starts.',
      },
    ],
    watch: [
      'Before the change, the traffic never passes what the database can do, and yet after the first burst its gauge goes to the top and stays there. The panel that says where the time goes reports that it is running more queries than it has cores for.',
      'After it, the gauge on Database settles at about three quarters, and the waiting, when there is any, shows on API instead: a few requests, for a moment.',
      'Then set the pool to 2 and run it again. Now API is the part that waits, for a free connection, while the database is half idle.',
    ],
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
    parts: [
      {
        term: 'Shoppers',
        text:
          'A client, sending 200 requests a second. Four in five are browsing, which only reads. One in five is a purchase, ' +
          'which writes: 40 a second.',
      },
      {
        term: 'Shop',
        text:
          'A service, and the one that is yours. It has 32 slots and does 5 ms of work on each request. For a purchase it then ' +
          'calls Payments and waits for the answer, holding its slot.',
      },
      {
        term: 'Payments',
        text:
          'Another service, standing for one that somebody else runs. It normally answers in 20 ms. At 0:20 it becomes a ' +
          'hundred times slower, two seconds a call, and stays that way for forty seconds. Nothing about it can be changed.',
      },
    ],
    words: [
      { term: 'Dependency', text: 'A part that another part needs in order to answer. Payments is a dependency of Shop.' },
      {
        term: 'Waiting for the answer',
        text:
          'When one part calls another and waits, it keeps its own slot until the answer comes. So a slow part at the back can ' +
          'fill up a healthy part in front of it.',
      },
      {
        term: 'Failing fast',
        text: 'Giving up early on purpose. A request that fails in a fraction of a second costs far less than one that waits for seconds and fails anyway.',
      },
      {
        term: 'Circuit breaker',
        text:
          'A switch on a connection. When enough recent calls have failed it stops calling for a while, so that callers fail at ' +
          'once, and then lets a call through to see whether the other part has recovered. This level can be passed without one.',
      },
    ],
    settings: [
      {
        term: 'Give up after',
        text:
          'The timeout on this connection: how long the caller waits for an answer before it gives up and counts the call as ' +
          'failed. Its slot is given back at that moment. The work at the other end is not cancelled.',
      },
    ],
    watch: [
      'Before the change, watch Shop when Payments turns slow at 0:20. Its gauge goes to the top within a second or two, though Shop itself is doing almost no work: its slots are full of purchases that are waiting.',
      'After it, the gauge on Shop rises a little and stays under the load line. Browsing carries on as if nothing had happened.',
      'The failures that are left are the purchases made while Payments is slow. The panel that says why requests failed names Payments, not Shop.',
    ],
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
    parts: [
      {
        term: 'Users',
        text:
          'A client, sending 400 requests a second. It waits 150 ms for an answer, and as the level starts it sends a failed ' +
          'call again at once, up to three times.',
      },
      {
        term: 'API',
        text:
          'A service with 16 slots. A request takes about 30 ms, so it can finish about 530 a second. Its waiting room holds ' +
          '512. At 0:20 it becomes three times slower, for five seconds.',
      },
    ],
    words: [
      { term: 'Retry', text: 'Sending a call again after it failed or timed out. It hides a brief fault from the user, and it is extra load.' },
      {
        term: 'Work for nobody',
        text:
          'A timeout ends the waiting, not the work. The call that was given up on keeps its place in the waiting room and is ' +
          'served when its turn comes, though nobody wants the answer any more.',
      },
      { term: 'Backoff', text: 'Waiting before a retry, and longer before each further one.' },
      { term: 'Jitter', text: 'Randomness added to a wait, so that callers who failed at the same moment do not all come back at the same moment.' },
      { term: 'Load shedding', text: 'Turning work away early, on purpose, so that the work that is accepted can still be finished in time.' },
    ],
    settings: [
      {
        term: 'Waiting room, per instance',
        text:
          'How many requests may wait for a free slot. A long one lets requests wait longer than anyone will wait for them. A ' +
          'short one refuses them at once when the service is busy, which is quicker for everybody.',
      },
      { term: 'Retries', text: 'How many more times the caller sends a call that failed or timed out. 2 means up to 3 tries in all.' },
      { term: 'Wait before the first retry', text: 'How long the caller waits before it sends the call a second time. 0 sends it again at once.' },
      { term: 'Each further wait is longer by', text: 'What each wait is multiplied by to give the next one. With 2, a wait of 50 ms is followed by one of 100 ms.' },
      {
        term: 'Randomise the wait',
        text: 'With 0 every retry comes exactly on time. With 1 each comes at a moment picked at random between no wait at all and the full wait.',
      },
    ],
    watch: [
      'Before the change, compare the rate shown on Users with the rate arriving at API once the slow spell is over, at 0:25. The API is receiving several times what the users send, and its waiting room never empties.',
      'After it, some calls are refused during the slow five seconds, and a few seconds later everything is as it was before.',
      'In the panel that says why requests failed, the storm reads as calls that timed out waiting in line at API. With the short waiting room those are gone.',
    ],
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
    parts: [
      {
        term: 'Customers',
        text: 'A client that places orders, 80 a second. Every one is a write. At 0:20 a sale begins, and for ten seconds 400 a second arrive.',
      },
      {
        term: 'Orders',
        text:
          'The service that takes an order. It has plenty of slots and does 2 ms of work, and then has the order recorded ' +
          'before it answers the customer.',
      },
      {
        term: 'Ledger',
        text: 'The service that records each order. It works on 4 at a time and each takes 40 ms, so it records 100 a second. You will take it out.',
      },
      {
        term: 'Queue',
        text:
          'A part you will add. It holds messages in the order they arrive and tells the sender at once that it has them. It ' +
          'does no work on them.',
      },
      {
        term: 'Worker',
        text:
          'A part you will add. It takes messages from a queue and does the work, at its own pace: as fast as its instances can ' +
          'go, however many are waiting. Here an instance records as the Ledger did, 4 at a time and 40 ms each.',
      },
    ],
    words: [
      { term: 'Burst', text: 'A short spell of traffic far above the usual.' },
      {
        term: 'Asynchronous',
        text: 'The caller hands the work over and does not wait for it to be done. The opposite, waiting for the answer, is called synchronous.',
      },
      { term: 'Backlog', text: 'The messages waiting in a queue. It grows while more arrive than the workers finish, and shrinks when fewer do.' },
      { term: 'Lost message', text: 'A message the queue had to refuse because it was full. The level allows none.' },
    ],
    settings: [
      {
        term: 'The caller',
        text:
          'Whether the caller waits for the work to be done. If it waits for the answer, it holds its slot until then. If it ' +
          'hands the work over and moves on, it is free as soon as the other part has taken the message, which is how to talk ' +
          'to a queue.',
      },
      {
        term: 'Instances',
        text: 'On a worker, how many copies take messages from the queue. Each one adds 100 orders a second, and each one is paid for all day.',
      },
    ],
    watch: [
      'Before the change, the gauge on Ledger goes to the top at 0:20, its waiting room fills, and four customers in ten are turned away.',
      'After it, watch the number waiting on the Queue. It climbs to about 2,000 during the sale and then falls steadily, and the queue is empty about 17 seconds after the sale ends.',
      'The numbers under the canvas hardly move through the sale. The customers are answered as quickly as on a quiet day.',
    ],
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
      'clear only 20 a second more than arrives and would not finish in time. A third or a fourth would finish sooner, for a wait ' +
      'that no customer sees, and each one is paid for all day. Size workers for ' +
      'the catch-up, not for the burst.',
    others: [
      'A queue and one worker instance: it fails. More than a thousand orders are still unrecorded when the run ends.',
      'A queue and three instances: two stars. Four: one. Everything is recorded sooner, which nobody was waiting for, and it costs more.',
      'Five instances: it fails, on cost.',
      'Two instances and a queue that holds only 500 messages: it fails. The queue fills during the sale and orders are lost.',
    ],
  },
  stampede: {
    parts: [
      { term: 'Shoppers', text: 'A client. Its traffic builds up to 1,500 reads a second, nearly all of them for the same 40 products.' },
      {
        term: 'Catalog',
        text:
          'A service with slots to spare. For each request it asks the cache first, and goes to the database only for what the ' +
          'cache does not have.',
      },
      {
        term: 'Cache',
        text:
          'A memory of recent answers. It holds 100 items and keeps each one until it is pushed out, so normally it answers ' +
          'almost everything. At 0:25 a deploy empties it.',
      },
      {
        term: 'Database',
        text:
          'Stores the products. It has 8 cores and a query takes 40 ms, so it finishes 200 a second. It is small because the ' +
          'cache normally leaves it little to do, and it cannot be made bigger.',
      },
    ],
    words: [
      {
        term: 'Deploy',
        text: 'Putting a new version of the software into service. It often restarts things, and a cache that has been restarted is an empty one.',
      },
      { term: 'Cold cache', text: 'A cache with nothing in it yet. Every request misses until it has filled again.' },
      { term: 'Stampede', text: 'Many requests missing the same item at the same moment, and all of them going to fetch it.' },
    ],
    settings: [
      {
        term: 'Fetch a missing item once, for everyone waiting on it',
        text:
          'When it is on, the first request that misses an item goes to fetch it, and every other request for that item waits ' +
          'for that one answer. When it is off, every request that misses fetches the item for itself.',
      },
      {
        term: 'Connections per instance',
        text: 'The size of the connection pool: how many queries each instance of Catalog may have in progress on the database at once. 0 is no limit.',
      },
    ],
    watch: [
      'Before the change, watch 0:25. The share of hits on the Cache drops to nothing, the Database shows hundreds of queries too many at once, and for several seconds almost nobody is answered.',
      'After it, the same moment is a blip. The cache is full again almost at once, because each product was fetched one time.',
      'The level is scored only from 0:23, around the moment the cache is emptied. What comes before is the cache filling for the first time.',
    ],
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
    parts: [
      {
        term: 'Shoppers',
        text:
          'A client. On a normal day it sends 100 requests a second. From 0:30 to 1:00 the sale takes that up to 650, and ' +
          'between 1:20 and 1:30 it falls back.',
      },
      {
        term: 'Balancer',
        text: 'A load balancer. It spreads the calls over whatever instances of Shop are running at the moment, new ones included as they start.',
      },
      {
        term: 'Shop',
        text:
          'A service. One instance works on 4 requests at a time at 20 ms each, so it finishes 200 a second. It starts with 2 ' +
          'instances. A new one takes 10 seconds to start, and one is taken away only after 20 seconds of not being needed.',
      },
    ],
    words: [
      { term: 'Autoscaling', text: 'A service changing its own number of instances as the load changes: more when it is busy, fewer when it is quiet.' },
      {
        term: 'Start-up time',
        text: 'How long a new instance takes before it can do any work. Until then, the instances that are already there carry everything.',
      },
      {
        term: 'Room to spare',
        text: 'Slots that are free on purpose. Elsewhere it is called headroom. It is what takes up a rise in load while help is still on its way.',
      },
      { term: 'Average cost', text: 'The bill is averaged over the run. An instance that runs for a minute costs a small part of one that runs all day.' },
    ],
    settings: [
      {
        term: 'Add and remove instances by itself',
        text: 'Turns autoscaling on. The service then watches how busy its slots are, and orders instances or gives them up to suit.',
      },
      {
        term: 'Share of slots to keep busy',
        text:
          'The target it steers by. Above it, it adds instances; well below it, it removes them. A low target means more are ' +
          'running than the load strictly needs, and that is the room to spare.',
      },
      { term: 'Most instances', text: 'The upper limit. It never runs more than this, however busy it gets.' },
    ],
    watch: [
      'Before the change, the gauge on Shop passes the load line soon after the climb starts at 0:30, and is at the top long before the peak.',
      'After it, watch the count of instances on Shop. It goes up in steps during the climb, each step some ten seconds after the load that called for it, and comes back down after the sale.',
      'Set the target to 0.8 and run it again. The count still goes up, but always too late, and requests fail all the way up the climb.',
    ],
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
    parts: [
      { term: 'Users', text: 'A client, sending 240 requests a second.' },
      {
        term: 'Balancer',
        text:
          'A load balancer in front of API. It checks whether each instance is alive, and as the level starts it checks every ' +
          'ten seconds. Between checks it knows nothing, and goes on sending calls to an instance that has died.',
      },
      {
        term: 'API',
        text:
          'A service with 2 instances. Each works on 8 requests at a time at 40 ms each, so each finishes about 200 a second. ' +
          'About 21 seconds in, one of them dies.',
      },
    ],
    words: [
      { term: 'Dead instance', text: 'An instance that has stopped. It answers nothing, and a call sent to it fails at once.' },
      {
        term: 'Health check',
        text: 'A balancer asking each instance, every so often, whether it is still there. One that does not answer gets no more calls.',
      },
      {
        term: 'Redundancy',
        text: 'Having more than the load needs, so that losing one leaves enough. Running one more instance than is needed is called N+1.',
      },
    ],
    settings: [
      { term: 'Instances', text: 'How many copies of API run. Count them for the moment after one has died, not for a normal day.' },
      { term: 'Check for dead instances every', text: 'The time between health checks. A dead instance goes on being sent calls until the next one.' },
      {
        term: 'Retries',
        text:
          'How many more times a failed call is sent. On the connection from the balancer to the service, the call goes to an ' +
          'instance again, so one that landed on the dead instance is tried on a live one and the user sees nothing.',
      },
    ],
    watch: [
      'Before the change, watch 0:21. The count of instances on API drops from 2 to 1, half the calls turn red until the next health check, and after that the one instance left is over the load line.',
      'After it, the count drops from 3 to 2 and little else changes. The gauge on API rises to about 60%, still under the load line.',
      'The Failed number under the canvas is what the stars count here. With the retry in place it stays at 0.',
    ],
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
    parts: [
      {
        term: 'Users',
        text:
          'A client. It sends 600 requests a second, and 900 during the busy stretch from 0:40 to 1:00. Nine in ten are reads, ' +
          'of 5,000 different items.',
      },
      { term: 'Balancer', text: 'A load balancer, spreading calls over the instances of API.' },
      {
        term: 'API',
        text:
          'A service. One instance works on 12 requests at a time, at about 10 ms each. For a read it asks the cache and then, ' +
          'on a miss, the database. For a write it goes to the database and also leaves an email in the queue.',
      },
      { term: 'Cache', text: 'Remembers recent answers, each for 20 seconds. It starts with room for 50,000 items, ten times as many as exist.' },
      {
        term: 'Database',
        text: 'Stores the data. It starts with 32 cores and 2 read replicas, which are extra copies of it that answer reads.',
      },
      { term: 'Emails to send', text: 'A queue. Each write leaves a message here, and is answered without waiting for the email to go.' },
      {
        term: 'Mailer',
        text:
          'A worker. It takes emails from the queue and sends them, 4 at a time for each instance and about 60 ms each. It ' +
          'starts with 6 instances.',
      },
    ],
    words: [
      { term: 'Rightsizing', text: 'Making each part as large as its load needs, and no larger.' },
      {
        term: 'Peak and average',
        text:
          'A part that people wait on has to be big enough for the busiest moment. A part behind a queue only has to keep up ' +
          'over time, because the queue holds the difference.',
      },
      { term: 'Over-provisioned', text: 'Larger than the load needs. It is safe, and it is paid for every month.' },
    ],
    settings: [
      { term: 'Instances', text: 'How many copies of a service or of a worker run. Each is paid for by the month.' },
      {
        term: 'Queries at full speed at once',
        text: "The database's cores. Each runs one query at a time at full speed, and more cores cost more.",
      },
      {
        term: 'Read replicas',
        text: 'Extra copies of the database that answer reads. Each is another whole server to pay for. 0 means the one server does everything.',
      },
      { term: 'Items it can hold', text: 'The size of the cache. Beyond the number of items that exist, more room holds nothing.' },
    ],
    watch: [
      'Run it first as it is. Through the busy stretch the gauges on API, Database and Mailer are all far below the load line: that is what too large looks like.',
      'After the change, the same gauges stand much nearer the line at the peak and still under it, and the cost under the canvas is a fraction of what it was.',
      'The number waiting on Emails to send stays small with 2 instances of Mailer. Try 1: it builds up during the busy stretch and is still there when the run ends.',
    ],
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
    parts: [
      { term: 'Users', text: 'A client, sending 850 requests a second.' },
      {
        term: 'Balancer',
        text:
          'A load balancer in front of API. As the level starts it picks an instance at random for each call, without looking ' +
          'at how busy any of them is.',
      },
      {
        term: 'API',
        text:
          'A service with 10 small instances. Each works on only 2 requests at a time at about 20 ms each, so each finishes 100 ' +
          'a second and all of them together 1,000. It is fixed: the fix is in how the calls are shared out.',
      },
    ],
    words: [
      { term: 'Balancing rule', text: 'How a load balancer decides which instance gets the next call. It is also called the balancing algorithm.' },
      {
        term: 'Lumpy',
        text: 'Random choices do not spread evenly. At any moment a few of the instances have been picked several times running, and a few not at all.',
      },
      {
        term: 'The slow few',
        text: 'The requests that take longest, which is what p99 measures. Here they are slow only because they were sent to an instance that already had a queue.',
      },
    ],
    settings: [
      {
        term: 'How it picks an instance',
        text:
          'The balancing rule. At random looks at nothing. Each in turn goes round the instances in order. The least busy looks ' +
          'at all of them and takes the one with the fewest calls in progress. The less busy of two picked at random looks at ' +
          'just two.',
      },
    ],
    watch: [
      'Before the change, the gauge on API shows about 85% busy, which is the average over all the instances. The waiting is hidden inside it: some instances have a queue while others are idle.',
      'After it, the gauge reads the same, because the same work is being done. What changes is p99 under the canvas, which falls to about a third.',
      'Try each of the rules in turn and compare p99. Nothing else about the system changes.',
    ],
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
    parts: [
      { term: 'Users', text: 'A client, sending 1,000 searches a second. All of them are reads.' },
      {
        term: 'Site',
        text:
          'A thin service in front. It does 2 ms of work, passes the search on to Search and waits for the answer. As the level ' +
          'starts it waits 100 ms, and asks again up to twice if no answer has come.',
      },
      {
        term: 'Search',
        text:
          'The service that does the searching. It has 72 slots and a search takes 60 ms on average, so it has room for 1,200 a ' +
          'second. But the time varies a great deal from one search to the next. It is fixed.',
      },
    ],
    words: [
      {
        term: 'Uneven work',
        text:
          'Not every request takes the same time. Here half the searches finish in under 30 ms and a few take many times the ' +
          'average. The average says little about the slow ones.',
      },
      {
        term: 'The tail',
        text: 'The slowest few answers. Trimming the tail means cutting those off and asking again, which is usually quicker than waiting for them.',
      },
      {
        term: 'A timeout that is too early',
        text: 'One that cuts off answers that were healthy and on their way. Each of those becomes a failure and, with retries, extra load.',
      },
    ],
    settings: [
      {
        term: 'Give up after',
        text: 'The timeout: how long Site waits for Search before it gives up on that try. Search is not told, and carries on with the work.',
      },
    ],
    watch: [
      'Before the change, nothing is ever broken, and still the gauge on Search goes to the top and stays there. Compare the 1,000 a second that Users send with the rate arriving at Search.',
      'After it, Search receives only a little more than Users send, and its gauge comes off the top.',
      'Try 150 ms, and then 1,000 ms. The first brings the storm back. The second never fails and is slow: look at p99.',
    ],
    problem:
      'Search answers in 60 ms on average, but very unevenly: half its answers take under 30 ms, and about one in six takes ' +
      'more than 100 ms. That is exactly where the site gives up. It calls each of those slow answers a failure and asks ' +
      'again, up to twice, while Search carries on with the first. Search has room for 1,200 calls a second and gets 1,000; ' +
      'the repeats push it past what it can do. Then everything is late, everything is retried, and it never recovers. ' +
      'Nothing broke. The timeout did this.',
    idea:
      'A timeout is a statement about how long a healthy answer can take. Set it from what the service really does: just ' +
      'past the point where nearly all its answers have arrived. Too early, and you fail requests that were about to succeed ' +
      'and load a service that was fine. Far too late, and you sit waiting for its slowest answers when asking again would ' +
      'have been quicker. Cutting off the slowest few and asking again is a way of trimming the tail.',
    steps: ['Select the connection from Site to Search.', 'Set "Give up after" to 300 ms. Leave the two retries as they are.'],
    why:
      'By 300 ms all but three answers in a hundred have arrived. Those three are asked for again, and the second answer ' +
      'usually comes in a few tens of milliseconds, so the slowest 1% of requests take about 360 ms instead of over half a ' +
      'second. Three extra calls in a hundred is load Search can carry. At 150 ms it would be nine in a hundred, and that is ' +
      'enough to start the storm again.',
    others: [
      'A timeout of 150 ms: it fails. Too many healthy answers are cut off, and the storm starts again.',
      'A timeout of 250 ms: three stars as well.',
      'A timeout of 400 ms: two stars. Of 500 ms, of one second or of three: one star. Nothing fails, and the slowest answers are simply waited for.',
      'A timeout of 300 ms and no retries: it fails. Three requests in a hundred are cut off and nobody asks again.',
      'A timeout of 300 ms with a tenth of a second between retries: two stars. The wait is added to exactly the requests that were already slow.',
    ],
  },
  'full-house': {
    parts: [
      { term: 'Fans', text: 'A client. It sends 150 requests a second, and during the sale, from 0:20 to 1:00, 450.' },
      {
        term: 'Tickets',
        text:
          'The service that sells tickets. It works on 10 requests at a time at about 40 ms each, so it finishes 250 a second, ' +
          'and its waiting room holds 256. It is fixed: it may not grow.',
      },
      {
        term: 'Rate limiter',
        text:
          'The part you will add. A door in front of a service. It lets a set number of calls through each second and refuses ' +
          'the rest at once, without making them wait.',
      },
    ],
    words: [
      {
        term: 'Overload',
        text: 'More work arriving than can be done, with no way of doing more. Somebody has to be turned away. The only choice is who, and how quickly.',
      },
      { term: 'Load shedding', text: 'Turning the excess away early and on purpose, so that those who are let in are served quickly.' },
      {
        term: 'Saved-up allowance',
        text:
          'A rate limiter counts its allowance like tokens in a bucket. While traffic is below the rate, the unused tokens pile ' +
          'up, to a limit, and a sudden rush may spend them all at once.',
      },
    ],
    settings: [
      { term: 'Calls let through per second', text: 'The steady rate of the door. Set it a little under what the service behind it can finish.' },
      {
        term: 'Calls let through at once after a quiet spell',
        text: 'How much unused allowance can be saved up. After a quiet time, this many calls may pass in the same instant, on top of the steady rate.',
      },
    ],
    watch: [
      'Before the change, the sale fills the waiting room of Tickets. The part shows 256 waiting, and p99 goes to about a second: everyone who is served has stood in that line first.',
      'After it, the refusing happens at the limiter, and Tickets stays busy without a queue. Fans are still turned away, because there is still not room for them all, but those who get in are answered at once.',
      'In the panel that says why requests failed, the reason changes: from turned away by Tickets, which was full, to refused by the limiter, over its rate.',
    ],
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
    parts: [
      {
        term: 'Searchers',
        text:
          'A client. Each second it sends 360 reads and 40 writes. There are a million documents and they are asked for evenly, ' +
          'so hardly any is asked for twice.',
      },
      { term: 'API', text: 'A service that does 2 ms of work and then runs a query on the database.' },
      {
        term: 'Database',
        text:
          'One server with 4 cores and 12 ms a query, so about 330 queries a second. Its cores are fixed. What can be added is ' +
          'copies of it.',
      },
      {
        term: 'Cache',
        text: 'It is offered among the parts, and it is a trap. A cache answers a read that was made before, and here almost none was.',
      },
    ],
    words: [
      { term: 'Primary', text: 'The one database server that takes the writes.' },
      {
        term: 'Read replica',
        text: 'A copy of the database on a server of its own. Writes are copied to it from the primary, and it answers reads.',
      },
      { term: 'Scaling out', text: 'Adding more servers. The other way, making one server bigger, is called scaling up.' },
    ],
    settings: [
      {
        term: 'Read replicas',
        text: 'How many copies answer reads. Once there is at least one, the reads are spread over the replicas and the primary keeps only the writes.',
      },
      {
        term: 'Connections per instance',
        text:
          'The size of the connection pool from API to the database, replicas included. It has to grow with the number of cores ' +
          'behind it, and it still has to be a limit.',
      },
    ],
    watch: [
      'Before the change, the gauge on Database is at the top and most requests fail.',
      'After it, the gauge comes down under the load line. Add a Cache as well and look at its share of hits: it stays close to nothing.',
      'Set the replicas to 1 and run it again. It is no better than none: the one replica now carries all 360 reads alone.',
    ],
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
    parts: [
      { term: 'Shoppers', text: 'A client, sending 2,000 reads a second. There are 100 prices, and each is asked for as often as any other.' },
      { term: 'Prices', text: 'A service with slots to spare. It asks the cache for a price, and the database when the cache does not have it.' },
      {
        term: 'Cache',
        text:
          'Holds every price, and keeps each for exactly 20 seconds. It already fetches a missing price only once, for everyone ' +
          'waiting on it.',
      },
      { term: 'Database', text: 'It has 16 cores and needs 130 ms for a query. It is fixed.' },
    ],
    words: [
      {
        term: 'Lifetime',
        text:
          'How long a cache keeps an item before it throws it away and fetches it afresh. It is often written TTL, for time to ' +
          'live. It is what stops a cache from serving an old price for ever.',
      },
      { term: 'Expiry', text: 'The moment an item reaches the end of its lifetime. The next request for it is a miss.' },
      { term: 'In step', text: 'Things that were started at the same moment, on the same timer, come due at the same moment, time after time.' },
      { term: 'Jitter', text: 'A little randomness added to a timer, so that things drift out of step.' },
    ],
    settings: [
      {
        term: 'Randomise lifetimes',
        text:
          'A number from 0 to 1. With 0 every item lives the full time. With 0.1 each lives a time picked at random between ' +
          'nine tenths of it and all of it.',
      },
    ],
    watch: [
      'Before the change, look at the chart of response time. p99 jumps every 20 seconds, as regular as a clock, and between the jumps everything is fast.',
      'At each jump the Database shows many queries too many at once, and then nothing at all until the next.',
      'After it, the first jump is still there. Each one after it is lower and wider, and within a minute the line is flat.',
    ],
    problem:
      'A hundred prices are each asked for twenty times a second, and the cache keeps each for exactly twenty seconds. When ' +
      'the site starts, all hundred are fetched in the same moment. So they all expire in the same moment and are all fetched ' +
      'again together: a hundred queries at once on a database of 16 cores that needs 130 ms for each. Until they are done, ' +
      'nobody gets a price. Twenty seconds later it happens again, and again, because being fetched together is what keeps ' +
      'them together.',
    idea:
      'Things that are stored at the same time with the same lifetime expire at the same time. Give each item a slightly ' +
      'different lifetime and they drift apart, so the store sees a steady trickle instead of a wave. This is called adding ' +
      'jitter to the expiry, and it applies to anything on a timer: caches, scheduled jobs, clients that all reconnect after ' +
      'an outage. A little is enough. Randomising also shortens lifetimes, and every expiry is a fetch that somebody waits for.',
    steps: ['Select the Cache.', 'Set "Randomise lifetimes" to 0.1.'],
    why:
      'A price now lives somewhere between eighteen and twenty seconds, so the hundred no longer run out together. The first ' +
      'time round they spread over two seconds, the next time over more, and within a minute the database is fetching about ' +
      'five prices a second with nobody held up. A tenth is enough to do that and costs almost nothing: prices still live ' +
      'nineteen seconds on average.',
    others: [
      'Randomised by 0.01 or 0.02: it fails. The prices drift apart too slowly to help within the run.',
      'By 0.2: three stars as well.',
      'By 0.5: two stars. By 0.7, or completely: one. The waves are gone either way, but prices live a shorter time, so there are more fetches and more requests that arrive while one is under way.',
      'Fetching a missing price only once is already on, and does not help: these are a hundred different prices, not one price asked for a hundred times.',
    ],
  },
  'nine-times': {
    parts: [
      {
        term: 'Users',
        text:
          'A client, sending 100 requests a second. It waits up to a second for an answer and, as the level starts, tries twice ' +
          'more if a request fails.',
      },
      {
        term: 'Web',
        text:
          'The service in front. It does 60 ms of work of its own and then calls API, giving it 150 ms and trying twice more if ' +
          'that call fails.',
      },
      {
        term: 'API',
        text:
          'The service at the back. It has 15 slots and a call takes about 40 ms, so it can handle 375 a second. At 0:20 it ' +
          'becomes four times slower, for five seconds.',
      },
    ],
    words: [
      { term: 'Layer', text: 'One step in a chain of calls. Here there are two: Users calling Web, and Web calling API.' },
      { term: 'The edge', text: 'The outermost layer, where requests come into the system. Here it is the connection from Users to Web.' },
      {
        term: 'Multiplying',
        text:
          'A try at an outer layer runs the whole inner layer again, with all of its tries. So the tries of the layers are ' +
          'multiplied together: 3 times 3 is 9.',
      },
      { term: 'Retry budget', text: 'A limit on how much extra load retries may add across the whole chain.' },
    ],
    settings: [
      {
        term: 'Retries',
        text:
          'How many more times this connection sends a call that failed. Each connection has its own, and the number that ' +
          'matters is what they come to when multiplied together.',
      },
    ],
    watch: [
      'Before the change, compare the 100 a second on Users with the rate arriving at API after 0:25. It is several times that, and it does not come down.',
      'After it, the rate at API rises during the slow five seconds and is back to about 100 a few seconds later.',
      'The level is scored only from 0:35, ten seconds after the API has recovered. What it asks is whether the system got better again by itself.',
    ],
    problem:
      'Users call Web, and Web calls the API. Web gives the API 150 ms and tries twice more if a call fails. The user tries ' +
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
      'remain are worth keeping, and they are in the right place: even a healthy API is now and then slower than 150 ms, and ' +
      'when Web asks again only that one call is repeated.',
    others: [
      'Two retries at the edge and none inside, or one: two stars. Only one layer retries, so the storm cannot start. But each retry by the user makes Web do its 60 ms of work again, so the slow requests are slower.',
      'One retry inside and none at the edge: three stars as well.',
      'One retry at each layer: it fails. It looks more careful than two at one layer, and is four times the load instead of three, more than the API can carry.',
      'No retries anywhere: it fails. The storm cannot start, but the requests that a healthy API answers late simply fail.',
      'Two inside with a tenth of a second between them: one star. The wait is added to the requests that were already slow.',
      'Two at each layer with a wait between them: it fails. The calls are spread out, and there are still nine.',
      'Two at each layer and a circuit breaker on the connection to the API: three stars. The breaker stops the calls themselves instead of the retries.',
    ],
  },
  'wrong-suspect': {
    parts: [
      { term: 'Users', text: 'A client, sending 300 requests a second.' },
      { term: 'Web', text: 'The service in front, with 40 slots. It does 2 ms of work and then calls API and waits.' },
      {
        term: 'API',
        text:
          'The service in the middle, with 32 slots. It does 3 ms of work and then runs a query on the database and waits. Its ' +
          'connection to the database has a pool of 5.',
      },
      { term: 'Database', text: 'At the back. It has 4 cores and a query takes 16 ms, so it finishes 250 a second.' },
      {
        term: 'Load balancer',
        text:
          'It is offered among the parts in case you want more instances of Web or of API. That is the wrong fix, and it is ' +
          'worth trying once to see why.',
      },
    ],
    words: [
      { term: 'Bottleneck', text: 'The one part that limits how much the whole system can do. Making anything else bigger changes nothing.' },
      {
        term: 'Waiting up the chain',
        text:
          'While a call waits for the part behind it, it holds its slot, and so does the call that is waiting for it in the part ' +
          'in front. A shortage at the back shows as full slots all the way to the front.',
      },
      {
        term: 'Working and waiting',
        text:
          'A slot can be busy doing work, or busy waiting for another part. The gauge shows both alike. The panel that says ' +
          'where the time goes tells them apart.',
      },
    ],
    settings: [
      { term: 'Queries at full speed at once', text: "The database's cores. Each runs one query at a time at full speed." },
      {
        term: 'Connections per instance',
        text: 'The pool on the connection from API to the database. It should follow the number of cores: one more than there are.',
      },
    ],
    watch: [
      'Before the change, every gauge is at the top, and Web is the part that turns requests away. Read the panel that says where the time goes: it follows the waiting through Web and API to the Database.',
      'After it, the gauge on Database stands at about 80%, and Web and API, which were never changed, have emptied.',
      'Try the wrong fix once: give Web a second instance behind a Load balancer. It costs more, and nothing improves.',
    ],
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
    parts: [
      {
        term: 'Customers',
        text: 'A client, sending 300 requests a second. Nine in ten are browsing, which reads. One in ten is a purchase, which writes.',
      },
      { term: 'Shop', text: 'A service that does 2 ms of work and then reads from the database or writes to it.' },
      {
        term: 'Database',
        text: 'One server, called the primary. At 0:20 it fails, and it is 18 seconds before the database can be used again.',
      },
      { term: 'Queue', text: 'A part you will add. It takes a purchase at once and holds it until it can be written down.' },
      {
        term: 'Worker',
        text:
          'A part you will add. It takes purchases from the queue and writes each one to the database. While the database is ' +
          'away it tries again as often as its connection allows, and a purchase that runs out of tries is set aside and ' +
          'counts as lost.',
      },
    ],
    words: [
      { term: 'Primary', text: 'The database server that takes the writes. There is only ever one.' },
      { term: 'Failover', text: 'What happens when the primary fails: a new primary is chosen. Until that is done, nothing can be written.' },
      {
        term: 'Replica',
        text: 'A copy of the database that answers reads. When the primary fails it goes on answering them, and it becomes the new primary.',
      },
      {
        term: 'Patient retry',
        text:
          'Trying again after a wait, for long enough to outlast the fault. It suits a worker, which nobody is waiting for. It ' +
          'does not suit a service, where each wait holds a slot.',
      },
    ],
    settings: [
      { term: 'Read replicas', text: 'How many copies of the database answer reads. With 1, reads survive the loss of the primary.' },
      {
        term: 'Used by',
        text:
          'Which requests go by this connection: all of them, only the reads or only the writes. It is how the reads are sent ' +
          'one way and the writes another.',
      },
      {
        term: 'The caller',
        text: 'Whether the caller waits for the work to be done, or hands it over and moves on. A purchase is handed to the queue.',
      },
      { term: 'Retries', text: 'How many more times the worker tries a write that failed. 10 retries with 2 seconds between them last 20 seconds.' },
      { term: 'Wait before the first retry', text: 'How long the worker waits before it tries the write again.' },
      {
        term: 'Each further wait is longer by',
        text:
          'What each wait is multiplied by to give the next. 1 keeps every wait the same length, so the worker finds out soon ' +
          'after the database is back.',
      },
    ],
    watch: [
      'Before the change, everything turns red at 0:20 and stays red for 18 seconds.',
      'After it, browsing does not notice. The number waiting on the Queue climbs for those 18 seconds and is gone a few seconds after the database returns.',
      'The stars are for how long the oldest purchase waited in the queue. The Queue shows it on the canvas as its wait.',
    ],
    problem:
      'There is one database server, and at twenty seconds it fails. Eighteen seconds pass before the database can be used ' +
      'again, and in that time every request fails: browsing, which only reads, and buying, which writes. That is 300 ' +
      'requests a second for eighteen seconds.',
    idea:
      'Two different things have stopped, and they need two different answers. Reads need a second copy to read from: a ' +
      'replica, which also takes over as the new primary. Writes cannot be saved that way, because while the new primary is ' +
      'being chosen there is nowhere to write. They need somewhere to wait: a queue, with a worker that writes each purchase ' +
      'down once the database is back. A user cannot wait eighteen seconds. A message can.',
    steps: [
      'Select the Database and set "Read replicas" to 1.',
      'Add a Queue and a Worker from the parts on the left.',
      'Connect Shop to the Queue, the Queue to the Worker, and the Worker to the Database.',
      'Select the connection from Shop to the Queue. Set "Used by" to "Writes only" and "The caller" to "Hands it over and moves on".',
      'Select the connection from Shop to the Database and set "Used by" to "Reads only".',
      'Select the connection from the Worker to the Database. Set "Retries" to 10, "Wait before the first retry" to 2,000 ms and "Each further wait is longer by" to 1.',
    ],
    why:
      'The replica answers every read while the primary is gone, and then becomes the primary, so browsing never notices. ' +
      'Purchases go into the queue and the customer is answered at once. The worker tries to write each one, fails, waits two ' +
      'seconds and tries again, ten times if it has to: twenty seconds, which is longer than the database is away. And ' +
      'because no wait is longer than two seconds, it finds out almost at once when the database is back, and the purchases ' +
      'that piled up are written within a few seconds. Nothing is lost and nobody was kept waiting.',
    others: [
      'A replica and nothing else: it fails. Browsing survives, and every purchase made in those eighteen seconds is refused.',
      'A replica, and the shop itself retrying its writes with long waits: it fails badly. Each waiting purchase holds a slot of the shop, the slots run out, and browsing fails too.',
      'The queue and a patient worker, but no replica: it fails. Purchases are safe and nobody can browse.',
      'A queue with a worker that does not retry, or that retries five times at once: it fails. The worker uses up every chance a purchase has in a few milliseconds and sets it aside, and hundreds are lost.',
      'Waits that double each time, from one second: one star. Nothing is lost, but the worker is in the middle of a sixteen-second wait when the database comes back, and every purchase waits with it.',
      'Waits that grow by half each time, from two seconds: two stars. A steady five seconds: three, like two.',
      'Two replicas: it fails, on cost.',
    ],
  },
  'heavy-lifting': {
    parts: [
      {
        term: 'Visitors',
        text: 'A client, sending 600 requests a second. Three quarters ask for a picture, one of 20,000. The rest ask for data.',
      },
      {
        term: 'CDN',
        text:
          'Keeps copies of files close to the people who ask for them. A file it has is handed over at once, and one it does ' +
          'not have is fetched from behind it and kept. As the level starts it keeps a file for only 2 seconds. At 1:00 a ' +
          'release empties it.',
      },
      { term: 'Balancer', text: 'A load balancer, spreading calls over the instances of Site.' },
      {
        term: 'Site',
        text:
          'The service. It has 2 instances with 8 slots each, and does about 12 ms of work on a request. For a picture it then ' +
          'fetches the file from Images and waits for it.',
      },
      {
        term: 'Images',
        text:
          'Object storage: where the files are kept. Handing one over takes about 40 ms, and it takes no longer when a thousand ' +
          'are asked for at once. It is fixed.',
      },
    ],
    words: [
      {
        term: 'File',
        text: 'A picture, a script, a video: something that is the same for everyone who asks. That is what makes it safe to keep copies of.',
      },
      { term: 'Origin', text: 'Where a CDN goes for a file it does not have.' },
      {
        term: 'Object storage',
        text: 'A store for files, of the kind cloud providers sell. Each file is slow to fetch compared with a cache, and it never fills up or queues.',
      },
    ],
    settings: [
      {
        term: 'Used by',
        text: 'Which requests go by this connection. Files only sends the pictures this way and leaves everything else on the other connection.',
      },
      {
        term: 'Keep each file for',
        text: 'How long the CDN keeps a copy before it fetches the file again. A picture does not change, so it can be kept for a long time.',
      },
      { term: 'Instances', text: 'How many copies of Site run. With the pictures gone, one is enough.' },
    ],
    watch: [
      'Before the change, the gauge on Site is at the top, though three quarters of what it carries is pictures that it only passes along. On the CDN, the share held here is low.',
      'After it, the share held on the CDN is high and Site is nearly idle.',
      'At 1:00 the CDN is emptied. Its share drops for a moment, Images takes the rush, and Site does not notice.',
    ],
    problem:
      'Of 600 requests a second, 450 are for a picture. The CDN keeps a picture for 2 seconds and there are 20,000 of them, so ' +
      'most requests find it has already let theirs go. It asks the site, which does 12 ms of work and then waits about 40 ms ' +
      'for Images, holding a slot the whole time. Two instances have 16 slots between them, and the pictures keep nearly all of ' +
      'them waiting. The waiting room fills, and about a tenth of all requests fail.',
    idea:
      'Fetch files from where files are kept. A picture is the same for everyone, so the CDN can get it from storage itself, ' +
      'and the site never hears about it. Object storage has no slots to fill: a thousand files at once take as long each as ' +
      'one does. Elsewhere this is called giving static content an origin of its own.',
    steps: [
      'Connect CDN to Images.',
      'Select the connection from CDN to Images and set "Used by" to "Files only". The CDN sends a file by the connection that is for files, and everything else by the other.',
      'Select CDN and set "Keep each file for" to 300,000 ms, which is five minutes.',
      'Select Site and set "Instances" to 1.',
    ],
    why:
      'Files now go from the CDN to storage and nowhere else, so what the site carries is the 150 requests a second that are ' +
      'about data, which is under 2 slots. That alone passes. One instance is plenty for it, and that is the second star. The ' +
      'release still empties the CDN and for a moment every picture has to be fetched, but storage does not mind. The third ' +
      'star is for keeping pictures longer: the slowest requests left are the ones for a file the CDN had to fetch, and the ' +
      'fewer of those there are, the lower the p99.',
    others: [
      'Keeping files five minutes and still fetching them through the site: it fails. It works until the release, and then every picture lands on the site at once.',
      'That with a third instance, or four instances and nothing else: it fails, on cost.',
      'Fetching from storage and changing nothing else: one star. With one instance as well: two.',
      'Fetching from storage and keeping files five minutes, with both instances: one star. The second star is for the instance.',
      'Keeping each file for 0, which is until it is pushed out: three stars, like five minutes.',
    ],
  },
  'cold-start': {
    parts: [
      { term: 'Shoppers', text: 'A client. It sends 10 requests a second, and every 20 seconds there is a rush of 5 seconds at 200 a second.' },
      {
        term: 'Checkout',
        text:
          'A function. Nothing is kept running for it: each call runs in an environment of its own, which has to be started if ' +
          'none is free. Starting one takes 800 ms, the call itself about 50 ms, and an idle environment is let go after 8 seconds.',
      },
    ],
    words: [
      {
        term: 'Function',
        text:
          'Code that the cloud runs when it is called, and bills for the time it runs. It is often called serverless. There are ' +
          'no instances to count, and nothing to pay while it is idle.',
      },
      {
        term: 'Environment',
        text: 'The place one call runs in. It handles one call at a time, and the next call can use it again if it is still there.',
      },
      { term: 'Cold start', text: 'A call that finds no environment free and has to wait for one to be started.' },
      { term: 'Warm', text: 'An environment that is already started and waiting for a call.' },
    ],
    settings: [
      {
        term: 'Environments kept ready',
        text: 'How many environments are always warm. They are never let go, and they are paid for whether or not a call uses them.',
      },
    ],
    watch: [
      'Before the change, look at the chart of response time. Most requests are answered in about 50 ms, and at every rush p99 jumps by about the 800 ms of a start.',
      'After it, the jumps are gone and the cost under the canvas has gone up. Each environment kept ready adds $6 a month.',
      'Try 10, which is the average number of calls in progress during a rush. The slowest requests are as slow as they were: the average is not what the busy moments need.',
    ],
    problem:
      'In a rush 200 calls a second arrive where there were 10. Each takes 50 ms, so about ten are in progress at a time, and ' +
      'the function has one or two environments left from the quiet. Every call beyond those starts an environment and waits ' +
      '800 ms for it, and so do the calls that arrive during those 800 ms. An environment is let go 8 seconds after its last ' +
      'call, so by the next rush they are gone again. More than one request in a hundred waits for a start, which makes the ' +
      'slowest 1% all cold starts.',
    idea:
      'Keep some ready. An environment kept ready is never let go, so a call that gets one starts at once. It is called ' +
      'provisioned concurrency, and it is the same trade as an instance left running: you pay for it whether or not it is ' +
      'used. Size it for the busy moments of a rush, not for the average.',
    steps: ['Select Checkout.', 'Set "Environments kept ready" to 18.'],
    why:
      'Ten calls are in progress on average during a rush, but they do not arrive evenly and do not all take 50 ms, so at ' +
      'moments there are half as many again and more. 18 covers all but a few of those moments, and the calls that still wait ' +
      'for a start are fewer than 1 in 100. Each environment kept ready costs $6 a month, and every one beyond what a rush ' +
      'reaches is $6 for nothing. That is what the stars count.',
    others: [
      'Ten kept ready, which is the average, or twelve: it fails. More than one call in a hundred still waits for a start, so the slowest 1% look just as they did.',
      'Twenty-four: two stars. Thirty: one. They are as fast as eighteen, and cost more.',
      'Forty: it fails, on cost.',
    ],
  },
  'slow-lane': {
    parts: [
      {
        term: 'People',
        text:
          'A client with two routes. Of 300 requests a second, 270 are on the route called feed and read the feed, and 30 are on ' +
          'the route called post and send a photo in.',
      },
      { term: 'Balancer', text: 'A load balancer, spreading calls over the instances of API.' },
      {
        term: 'API',
        text:
          'The service. It has 2 instances with 8 slots each, and does 15 ms of work on a request. For the feed it then reads ' +
          'from Feed. For a post it sends the photo on to Photos and waits, holding its slot.',
      },
      { term: 'Feed', text: 'A database, and a quick one: a read takes about 5 ms. It is fixed.' },
      {
        term: 'Photos',
        text:
          'Object storage, where the photos are kept. Taking one in takes about 400 ms. At 0:50 it becomes three times slower, ' +
          'for 20 seconds. It is fixed.',
      },
    ],
    words: [
      {
        term: 'Route',
        text: 'One kind of request, with a name. A client can send each route by a connection of its own, and a level can score a route separately.',
      },
      {
        term: 'Bulkhead',
        text: 'A wall between kinds of work, so that one kind cannot use up what the other needs. The word comes from the walls that divide the hull of a ship.',
      },
      { term: 'Direct upload', text: 'Sending a file straight to storage, not through the service. The service is left with the quick requests.' },
    ],
    settings: [
      {
        term: 'Route',
        text: 'Keeps this connection for the requests of one route. Every other route goes by the connection that is not kept for any.',
      },
      {
        term: 'Give up after',
        text: 'The timeout on this connection. A post waits on nothing but storage now, so it can be given a long time without holding anything up.',
      },
      { term: 'Instances', text: 'How many copies of API run. With the posts gone, the feed needs only one.' },
    ],
    watch: [
      'Before the change, the gauge on API is at the top, and its slots are full of posts that are waiting for Photos. The panel under the canvas shows the two routes separately: both are failing.',
      'After it, the feed is fast all the way through. At 0:50 Photos slows down, the posts take longer, and the gauge on API does not move.',
      'Compare the two routes in the panel once more. The stars are for the cost, and for how few posts are given up on.',
    ],
    problem:
      'Of 300 requests a second, 270 look at the feed and 30 post a photo. A feed request is 15 ms of work and a quick read. A ' +
      'post is 15 ms of work and then about 400 ms of waiting for Photos, and it holds a slot the whole time. Thirty of those ' +
      'a second keep about 12 of the 16 slots of API waiting, and the feed needs 5 or 6. There is not room for both. The ' +
      'waiting room fills, and about a quarter of all requests fail, feed and posts alike.',
    idea:
      'Give the slow route its own way in. The requests of one route can leave the client by a connection of their own, so ' +
      'posts can go straight to storage and never take a slot from the feed. A wall like that between kinds of work is called ' +
      'a bulkhead. For uploads in particular it is the direct, or presigned, upload.',
    steps: [
      'Connect People to Photos.',
      'Select the connection from People to Photos and set "Route" to post. The feed still goes by the other connection.',
      'On the same connection, set "Give up after" to 10,000 ms.',
      'Select API and set "Instances" to 1.',
    ],
    why:
      'Posts now hold nothing but their own connection, so the API carries only the feed: about 5 slots of work, which one ' +
      'instance of 8 does easily. That is the second star. When storage slows down a post takes over a second, and nothing ' +
      'else notices. The third star is for letting it. With 3 seconds to finish, nearly 2 posts in 100 are given up on, most ' +
      'of them during the slow spell and most of them about to arrive. With 10 seconds almost none is.',
    others: [
      'Three or four instances of API: it fails. There is some room until storage slows down, and then there is none.',
      'Six instances: it fails, on cost, and the feed is still slow while storage is.',
      'A pool of 4 connections from API to Photos: it fails, and worse than before. A post waiting for a connection still holds its slot.',
      'The direct connection and nothing else: one star. With one instance as well: two.',
      'Ten seconds on the direct connection with both instances kept: one star. The second star is for the instance.',
      'One instance, and one second on the direct connection: it fails. Posts that would have finished are counted as failures.',
    ],
  },
};
