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
      'Put it between Users and API: connect Users to the balancer and the balancer to API, then select the old connection from Users straight to API and delete it.',
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
};
