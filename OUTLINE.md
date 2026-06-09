# Corellia - The Software Factory

## Requirements

- Ability to build on top of brownfield software projects
- Organization of different roles in the building process
- Evals and tests that exercise the relationships and handoffs between different roles in the factory
- Definition of inputs and outputs in the process

## Concepts and ideas

- Every agent in the software factory is the same "brain" but with a different harness
- A harness is 4 parts
  - Context
  - Memory
  - Tools
  - Evals
- If the roles in the factory are well enough defined, we can use simpler and cheaper models
  - I.e. rather than a master craftsman building an entire table, one person doing the same saw cut every time, one person drilling the same hole every time, one person sanding the edges every time
- A "dark" factory - a factory that doesn't need lights because humans aren't working there and the machines don't need to "see"
- Different roles/harnesses should have different tools, but may share some tools
- The factory isn't just for coding, its for the entire product development process

## Questions

- How do you measure performance?
  - Is this similar to evaluating a human employee? i.e. a review for a junior engineer vs a designer
- When does the human come into the loop?
  - Related: how do teams of humans collaborate with each other and the software factory?
- When does the factory choose to use one model vs another?
- Can the software factory do user research? Inspect product analytics? Ask stakeholders for feedback? i.e. the tasks that a product manager might direct
- What does DRY (Do not Repeat Yourself) mean in the context of a software factory?
- Is a software factory more like a functional, object oriented, or procedural language/paradigm?
- How do we know when to bring the human into the loop?
- How does the factory change depending on the kind of software being developed?
  - Is there a one-size-fits all factory or does the factory get customized for a specific kind of software build

## Tool Brainstorm

The kinds of things different harnesses in the software factory will need to do. Not necessarily an exact list of tools, but some of the tasks the agents will need to do.

- Manage memories
- Track tasks - internally or in an external system
- Web search
- Access and review product analytics
- Access designs in places like Figma
- Slack - get approvals, ask for feedback, interview users
- Edit files
- Run CLI commands
- Manage infrastructure
- Write code
- Access github
- Manage feature flags and experiments
- React to external events - datadog monitors, slack mentions, new jira tickets, etc

Things that may or may not be wise or necessary
- Install software
- Create/manage API keys
- Make purchases
- Create repositories

## Organization models

Different ways of viewing the organization.

- The factory hierarchy
  - A manager, supervisors, and workers
  - Hierarchical, things run top down from the manager down to the workers
- The Ant colony or Bee hive
  - Self organizing individuals work torwards a higher goal
  - Emergent intelligence
- The product dev team
  - An agile software development team
  - A product manager, designer, front end dev, back end dev, QA, devops, business stakeholder
- The military
  - Generals decide policy and strategy, lower ranks organize at increasingly smaller scales, down to the squad level

