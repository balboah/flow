package flow

import (
	"log"
	"sync"
)

// Broadcast messages to registered channels
type Broadcast struct {
	Inbox  chan Packet
	outbox []chan<- Packet
	mu     sync.RWMutex
}

func NewBroadcast() *Broadcast {
	b := &Broadcast{
		Inbox:  make(chan Packet, 1024),
		outbox: make([]chan<- Packet, 0, 2),
	}
	go func() {
		for p := range b.Inbox {
			b.send(p)
		}
	}()
	return b
}

func (b *Broadcast) Add(c chan<- Packet) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.outbox = append(b.outbox, c)
}

func (b *Broadcast) Del(c chan<- Packet) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for i, outboxc := range b.outbox {
		if c == outboxc {
			b.outbox = append(b.outbox[:i], b.outbox[i+1:]...)
		}
	}
}

func (b Broadcast) send(message Packet) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for i, c := range b.outbox {
		select {
		case c <- message:
		default:
			log.Print("Could not send packet to channel number", i)
		}
	}
}
