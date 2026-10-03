# ADAM — Adaptive Days-off Allocation Manager

I think we all have a common friend in AI:

**Adam — the Adaptive Moment Estimation optimizer.**

We use him to optimize neural networks, adjust parameters, minimize loss, and hopefully make our models a little smarter.

But today, I want to introduce you to a **different Adam**.

**ADAM — the Adaptive Days-off Allocation Manager.**

Instead of optimizing neural network parameters, **ADAM optimizes your holidays.**

It looks at Swiss public holidays, weekends, your available vacation days, and various constraints — and tries to answer one very important question:

> **How can you get the maximum amount of time off with the minimum number of vacation days?**

So the original Adam optimizes the model...

**ADAM optimizes your holidays.**

And after all the time we’ve spent learning about AI...

**it’s about time we optimized something that really matters.**

---

## Project Reflection

### What problem are you trying to solve, and for whom?

The problem is quite simple: planning holidays around Swiss public holidays and weekends can be surprisingly complicated.

ADAM is designed for **people working in Switzerland who want to make the most of their limited vacation days**. Instead of manually checking calendars and trying different combinations, ADAM finds combinations that maximize consecutive days off.

### What did you actually build?

I built a web-based prototype where users can enter their **canton, available vacation days, desired vacation periods, and other constraints**.

ADAM then analyzes weekends and Swiss public holidays and generates an optimized vacation plan — showing users **when to take vacation days to get the most time off**.

### What was the main challenge?

The main challenge was turning what sounds like a simple optimization problem into something that actually works for real-world holiday planning.

There are many constraints: different Swiss cantons have different holidays, holidays can fall on weekends, vacation periods can overlap, and users may have personal restrictions.

So the challenge was not just building the optimizer — it was **defining the problem correctly**.

### What is one thing you learned?

One thing I didn't expect was how quickly a seemingly simple optimization problem becomes complex once you add real-world constraints.

It reminded me that **good AI or optimization is not only about the algorithm — it starts with modelling the problem correctly.**

### What did you like about Bloom?

What I liked most about Bloom was the speed of going from an idea to a working prototype.

Instead of spending a lot of time setting up the basic application structure, I could focus on **describing the product, testing the result, and iterating on the experience**.

That made it particularly useful for turning an idea into something tangible very quickly.

### What did you miss or find difficult?

The main limitation was that, as the prototype became more sophisticated, I wanted **more control over the implementation details**.

For a simple prototype, abstraction is extremely useful. But once you start dealing with more complex optimization logic, APIs, data sources, and edge cases, you sometimes need to understand and control what is happening underneath.

### What would you build next?

If I had another few hours, I would make ADAM more comprehensive by adding **more Swiss holiday and calendar data, additional user constraints, and better visualization of the optimized vacation plans**.

I would also like to experiment with additional optimization strategies and eventually turn ADAM from a prototype into a **proper Swiss vacation optimization tool**.

Because if Adam can optimize neural networks...

**why shouldn't he optimize our holidays too?**
