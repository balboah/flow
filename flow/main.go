package main

import (
	"flag"
	"fmt"
	"github.com/balboah/flow"
	"log"
	"math/rand"
	"net/http"
	"time"
)

var (
	root = flag.String("www", "html", "Web root to serve from")
	port = flag.Int("port", 5000, "Port to listen on")
)

func main() {
	flag.Parse()

	rand.Seed(time.Now().UTC().UnixNano())
	log.Printf("Starting flow server at %v\n", fmt.Sprintf(":%v", *port))
	http.Handle("/worms", flow.WormsHandler())
	http.Handle("/", http.FileServer(http.Dir(*root)))

	err := http.ListenAndServe(fmt.Sprintf(":%v", *port), nil)
	if err != nil {
		panic("ListenAndServe: " + err.Error())
	}
}
