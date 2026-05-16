package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/balboah/flow"
)

var (
	root = flag.String("www", "html", "Web root to serve from")
	port = flag.Int("port", 5000, "Port to listen on")
)

func main() {
	flag.Parse()

	// Cloud Run (and other PaaS) inject $PORT. Honor it when the user hasn't
	// explicitly overridden via -port, so the same binary works locally and
	// in production without flag wrangling.
	if env, ok := os.LookupEnv("PORT"); ok && !flagSet("port") {
		if p, err := strconv.Atoi(env); err == nil {
			*port = p
		}
	}

	addr := fmt.Sprintf(":%v", *port)
	log.Printf("Starting flow server at %v\n", addr)
	http.Handle("/worms", flow.WormsHandler())
	http.Handle("/", http.FileServer(http.Dir(*root)))

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("ListenAndServe: %v", err)
	}
}

func flagSet(name string) bool {
	set := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == name {
			set = true
		}
	})
	return set
}
