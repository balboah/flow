Flow
====

What's this?
-----------

Started as a test of the [Go language](http://golang.org) I want to create a websocket based multiplayer snake game.
Since this is my first application in Go, expect some glitches until all the conventions are in place :)

A first draft of the gameplay:
-----------

Players can connect to a playfield using a link with the playfield id.
For each game there should be at least two players each controlling their own snake.
Collect points by picking up spawned "food" while avoiding colliding with your own- or the other players tail.

More food means higher score, higher score wins!
